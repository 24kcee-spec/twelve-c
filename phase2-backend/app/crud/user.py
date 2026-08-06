from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.user import User


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_google_id(db: AsyncSession, google_id: str) -> User | None:
    result = await db.execute(select(User).where(User.google_id == google_id))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, email: str, password: str) -> User:
    user = User(email=email.lower(), hashed_password=hash_password(password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def create_google_user(db: AsyncSession, email: str, google_id: str) -> User:
    # Google has already confirmed this email address, so these accounts
    # start out verified and with no password set.
    user = User(email=email.lower(), google_id=google_id, is_verified=True)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def link_google_id(db: AsyncSession, user: User, google_id: str) -> User:
    # An existing password account signing in with Google for the first
    # time - link the accounts instead of creating a duplicate.
    user.google_id = google_id
    user.is_verified = True
    await db.commit()
    await db.refresh(user)
    return user


async def mark_verified(db: AsyncSession, user: User) -> User:
    user.is_verified = True
    await db.commit()
    await db.refresh(user)
    return user

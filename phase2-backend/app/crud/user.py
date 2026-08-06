from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User
from app.core.security import get_password_hash

async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()

async def create_user(db: AsyncSession, user_in: dict) -> User:
    hashed_password = get_password_hash(user_in["password"])
    db_user = User(
        email=user_in["email"],
        hashed_password=hashed_password,
        full_name=user_in.get("full_name"),
        is_active=True,
        is_verified=True,
    )
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user
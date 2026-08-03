from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import create_refresh_token, hash_refresh_token
from app.models.refresh_token import RefreshToken

settings = get_settings()


async def issue_refresh_token(db: AsyncSession, user_id: uuid.UUID) -> str:
    raw_token = create_refresh_token(user_id)
    record = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.commit()
    return raw_token


async def get_valid_refresh_token(db: AsyncSession, raw_token: str) -> RefreshToken | None:
    token_hash = hash_refresh_token(raw_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    record = result.scalar_one_or_none()
    if record is None or record.revoked:
        return None

    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        # Some backends (e.g. SQLite) don't round-trip tzinfo; the value was
        # always written as UTC, so re-attach it rather than compare naive-vs-aware.
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        return None
    return record


async def revoke_refresh_token(db: AsyncSession, record: RefreshToken) -> None:
    record.revoked = True
    await db.commit()


async def revoke_all_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False)))
    for record in result.scalars():
        record.revoked = True
    await db.commit()

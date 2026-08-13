from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Nullable because Google sign-in accounts never set a password.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Set once a user signs in with Google. Accounts created this way are
    # auto-verified, since Google has already confirmed the email address.
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # --- Email verification (6-digit code, not a link) ---
    # Hashed the same way refresh tokens are - the DB never holds a usable
    # secret. Cleared once verification succeeds.
    verification_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Wrong-guess counter, reset on every new code. Blocks brute-forcing a
    # 6-digit code (1,000,000 combos) within its short expiry window.
    verification_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- Password reset (6-digit code, same pattern as email verification) ---
    reset_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reset_code_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reset_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- MFA (TOTP) ---
    # mfa_secret is stored only once the user has *confirmed* enrollment (see
    # /auth/mfa/verify). A secret being generated but never confirmed is kept
    # in mfa_secret_pending so a half-finished setup can't silently enable MFA.
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfa_secret_pending: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    businesses: Mapped[list["Business"]] = relationship(  # noqa: F821
        back_populates="owner", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(  # noqa: F821
        back_populates="user", cascade="all, delete-orphan"
    )
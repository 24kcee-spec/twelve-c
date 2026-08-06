from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from enum import StrEnum

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

# Argon2id: the current OWASP-recommended default for password hashing.
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"
    MFA_PENDING = "mfa_pending"  # short-lived token issued after password check, before TOTP
    EMAIL_VERIFY = "email_verify"  # emailed to the user after registration


def _create_token(subject: str, token_type: TokenType, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "type": token_type.value,
        "iat": now,
        "exp": now + expires_delta,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: uuid.UUID) -> str:
    return _create_token(
        str(user_id), TokenType.ACCESS, timedelta(minutes=settings.access_token_expire_minutes)
    )


def create_refresh_token(user_id: uuid.UUID) -> str:
    return _create_token(
        str(user_id), TokenType.REFRESH, timedelta(days=settings.refresh_token_expire_days)
    )


def create_mfa_pending_token(user_id: uuid.UUID) -> str:
    # Deliberately very short-lived: only bridges "password verified" -> "TOTP submitted".
    return _create_token(str(user_id), TokenType.MFA_PENDING, timedelta(minutes=5))


def create_email_verification_token(user_id: uuid.UUID) -> str:
    return _create_token(
        str(user_id), TokenType.EMAIL_VERIFY, timedelta(hours=settings.email_verification_expire_hours)
    )


def decode_token(token: str) -> dict:
    """Raises jose.JWTError (or subclasses) if invalid/expired - caller handles it."""
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


def hash_refresh_token(token: str) -> str:
    # Refresh tokens are bearer secrets - only their SHA-256 hash is stored,
    # the same principle as password storage: the DB never holds the usable secret.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


__all__ = [
    "JWTError",
    "TokenType",
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "create_mfa_pending_token",
    "create_email_verification_token",
    "decode_token",
    "hash_refresh_token",
]

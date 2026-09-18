from __future__ import annotations

import base64
import io

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

settings = get_settings()


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_provisioning_uri(secret: str, email: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.mfa_issuer_name)


def generate_qr_code_data_uri(provisioning_uri: str) -> str:
    """Returns a base64 data: URI a frontend can drop straight into an <img src>."""
    img = qrcode.make(provisioning_uri)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def verify_totp_code(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    # valid_window=1 tolerates minor client/server clock drift (+-30s).
    return totp.verify(code, valid_window=1)


# ---------------------------------------------------------------------------
# Encryption at rest for stored TOTP secrets.
#
# mfa_secret / mfa_secret_pending are only ever encrypted in the database -
# every other function in this module (verify_totp_code, get_provisioning_uri)
# still takes/returns the *raw* secret, unchanged. Callers decrypt on read and
# encrypt on write - see app/api/routes/auth.py for the call sites.
# ---------------------------------------------------------------------------


def _get_fernet() -> Fernet:
    if not settings.mfa_encryption_key:
        raise RuntimeError(
            "MFA_ENCRYPTION_KEY is not set. Generate one with: "
            'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" '
            "and set it in the environment before any MFA secret can be stored or read."
        )
    return Fernet(settings.mfa_encryption_key.encode())


def encrypt_mfa_secret(secret: str) -> str:
    """Encrypts a raw TOTP secret for storage. Call this immediately before
    writing to User.mfa_secret or User.mfa_secret_pending - never store the
    raw value returned by generate_totp_secret()."""
    return _get_fernet().encrypt(secret.encode()).decode()


def decrypt_mfa_secret(encrypted_secret: str) -> str:
    """Decrypts a value read from User.mfa_secret / mfa_secret_pending back
    into the raw secret verify_totp_code() and get_provisioning_uri() expect."""
    try:
        return _get_fernet().decrypt(encrypted_secret.encode()).decode()
    except InvalidToken as exc:
        raise ValueError(
            "Stored MFA secret could not be decrypted - it may predate "
            "encryption-at-rest and the migration backfill has not run, or "
            "MFA_ENCRYPTION_KEY has changed since it was written."
        ) from exc

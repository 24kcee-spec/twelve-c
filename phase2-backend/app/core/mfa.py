from __future__ import annotations

import base64
import io

import pyotp
import qrcode

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

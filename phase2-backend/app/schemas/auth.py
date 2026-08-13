from __future__ import annotations

import re
import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator

_PASSWORD_MIN_LEN = 12


def _validate_password_strength(v: str) -> str:
    if len(v) < _PASSWORD_MIN_LEN:
        raise ValueError(f"Password must be at least {_PASSWORD_MIN_LEN} characters")
    if not re.search(r"[A-Z]", v):
        raise ValueError("Password must contain an uppercase letter")
    if not re.search(r"[a-z]", v):
        raise ValueError("Password must contain a lowercase letter")
    if not re.search(r"\d", v):
        raise ValueError("Password must contain a digit")
    return v


class UserRegister(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    is_active: bool
    is_verified: bool
    mfa_enabled: bool

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    """What login/refresh endpoints return now that the refresh token
    travels only as an httpOnly cookie, never in the JSON body."""

    access_token: str
    token_type: str = "bearer"


class MfaRequiredResponse(BaseModel):
    mfa_required: bool = True
    mfa_pending_token: str


class MfaLoginRequest(BaseModel):
    mfa_pending_token: str
    totp_code: str


class RefreshRequest(BaseModel):
    refresh_token: str


class MfaSetupResponse(BaseModel):
    provisioning_uri: str
    qr_code_data_uri: str


class MfaVerifyRequest(BaseModel):
    totp_code: str


class MessageResponse(BaseModel):
    message: str


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class GoogleAuthRequest(BaseModel):
    # The ID token returned by Google Identity Services on the frontend
    # (google.accounts.id.callback response.credential), NOT an access token.
    id_token: str
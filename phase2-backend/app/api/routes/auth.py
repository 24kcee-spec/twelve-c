import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.deps import get_current_user
from app.core.email import send_password_reset_email, send_verification_email
from app.core.limiter import limiter
from app.core.mfa import (
    generate_qr_code_data_uri,
    generate_totp_secret,
    get_provisioning_uri,
    verify_totp_code,
)
from app.core.security import (
    JWTError,
    TokenType,
    create_access_token,
    create_mfa_pending_token,
    decode_token,
    generate_verification_code,
    hash_password,
    hash_verification_code,
    verify_password,
)
from app.crud.refresh_token import (
    get_valid_refresh_token,
    issue_refresh_token,
    revoke_refresh_token,
)
from app.crud.user import get_user_by_email
from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    AccessTokenResponse,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    MfaLoginRequest,
    MfaRequiredResponse,
    MfaSetupResponse,
    MfaVerifyRequest,
    ResendVerificationRequest,
    ResetPasswordRequest,
    UserOut,
    UserRegister,
    VerifyEmailRequest,
)

router = APIRouter()
settings = get_settings()

MAX_VERIFICATION_ATTEMPTS = 5
MAX_RESET_ATTEMPTS = 5

REFRESH_COOKIE_NAME = "refresh_token"
# Cookie only ever needs to travel to /auth/* endpoints - scoping the path
# keeps it out of every other request the browser makes.
REFRESH_COOKIE_PATH = "/auth"
# Cross-site cookies (frontend on Vercel, backend on Render) require
# SameSite=None + Secure. Locally, frontend and backend are both on
# "localhost" (same-site, different ports), so Lax + non-Secure works
# over plain http.
_IS_PROD = settings.environment != "development"
REFRESH_COOKIE_SECURE = _IS_PROD
REFRESH_COOKIE_SAMESITE = "none" if _IS_PROD else "lax"


def _issue_verification_code(user: User) -> str:
    code = generate_verification_code()
    user.verification_code_hash = hash_verification_code(code)
    user.verification_code_expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.email_verification_code_expire_minutes
    )
    user.verification_attempts = 0
    return code


def _issue_reset_code(user: User) -> str:
    code = generate_verification_code()
    user.reset_code_hash = hash_verification_code(code)
    user.reset_code_expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.email_verification_code_expire_minutes
    )
    user.reset_attempts = 0
    return code


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=REFRESH_COOKIE_SECURE,
        samesite=REFRESH_COOKIE_SAMESITE,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)


async def _issue_tokens(db: AsyncSession, user: User, response: Response) -> AccessTokenResponse:
    access_token = create_access_token(user.id)
    refresh_token = await issue_refresh_token(db, user.id)
    _set_refresh_cookie(response, refresh_token)
    return AccessTokenResponse(access_token=access_token)


def _decode_or_401(token: str, expected_type: TokenType, detail: str) -> uuid.UUID:
    try:
        data = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
    if data.get("type") != expected_type.value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
    try:
        return uuid.UUID(data["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


# ---------------------------------------------------------------------------
# Registration & email verification
# ---------------------------------------------------------------------------


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def register(request: Request, payload: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await get_user_by_email(db, payload.email)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        is_active=True,
        is_verified=False,
    )
    code = _issue_verification_code(user)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await send_verification_email(user.email, code)

    return user


@router.post("/verify-email", response_model=MessageResponse)
@limiter.limit("10/minute")
async def verify_email(request: Request, payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    generic_error = "That code is incorrect or has expired. Request a new one and try again."

    user = await get_user_by_email(db, payload.email)
    if user is None or user.is_verified:
        # Same message whether the account doesn't exist or is already
        # verified - don't leak which emails are registered.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    if user.verification_code_hash is None or user.verification_code_expires_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    expires_at = user.verification_code_expires_at
    if expires_at.tzinfo is None:
        # SQLite doesn't round-trip tzinfo; the value was always written as
        # UTC, so re-attach it rather than compare naive-vs-aware.
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    if user.verification_attempts >= MAX_VERIFICATION_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Request a new code and try again.",
        )

    if hash_verification_code(payload.code) != user.verification_code_hash:
        user.verification_attempts += 1
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    user.is_verified = True
    user.verification_code_hash = None
    user.verification_code_expires_at = None
    user.verification_attempts = 0
    await db.commit()
    return MessageResponse(message="Email verified. You can log in now.")


@router.post("/resend-verification", response_model=MessageResponse)
@limiter.limit("3/minute")
async def resend_verification(request: Request, payload: ResendVerificationRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, payload.email)
    # Always return the same message, whether or not the account exists -
    # avoids leaking which emails are registered.
    if user is not None and not user.is_verified:
        code = _issue_verification_code(user)
        await db.commit()
        await send_verification_email(user.email, code)
    return MessageResponse(message="If that account exists and isn't verified yet, a new code is on its way.")


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------


@router.post("/forgot-password", response_model=MessageResponse)
@limiter.limit("5/hour")
async def forgot_password(request: Request, payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    generic_message = "If that account exists, a password reset code is on its way."

    user = await get_user_by_email(db, payload.email)
    # Same response whether or not the account exists, and skip Google-only
    # accounts (hashed_password is None - there's no password to reset).
    if user is not None and user.hashed_password is not None:
        code = _issue_reset_code(user)
        await db.commit()
        await send_password_reset_email(user.email, code)
    return MessageResponse(message=generic_message)


@router.post("/reset-password", response_model=MessageResponse)
@limiter.limit("10/minute")
async def reset_password(request: Request, payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    generic_error = "That code is incorrect or has expired. Request a new one and try again."

    user = await get_user_by_email(db, payload.email)
    if user is None or user.hashed_password is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    if user.reset_code_hash is None or user.reset_code_expires_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    expires_at = user.reset_code_expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    if user.reset_attempts >= MAX_RESET_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Request a new code and try again.",
        )

    if hash_verification_code(payload.code) != user.reset_code_hash:
        user.reset_attempts += 1
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=generic_error)

    user.hashed_password = hash_password(payload.new_password)
    user.reset_code_hash = None
    user.reset_code_expires_at = None
    user.reset_attempts = 0
    await db.commit()

    # A password reset is a strong signal of compromise/recovery - kill every
    # existing session so a stolen session can't outlive the reset.
    result = await db.execute(
        select(User).where(User.id == user.id)
    )  # re-fetch not strictly needed, kept for clarity
    from app.crud.refresh_token import revoke_all_for_user

    await revoke_all_for_user(db, user.id)

    return MessageResponse(message="Password reset. You can log in with your new password now.")


# ---------------------------------------------------------------------------
# Login (password, MFA, refresh, logout)
# ---------------------------------------------------------------------------


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, response: Response, payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, payload.email)
    if user is None or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

    if not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Please verify your email before logging in")

    if user.mfa_enabled:
        pending_token = create_mfa_pending_token(user.id)
        return MfaRequiredResponse(mfa_pending_token=pending_token)

    return await _issue_tokens(db, user, response)


@router.post("/mfa/login", response_model=AccessTokenResponse)
@limiter.limit("10/minute")
async def mfa_login(request: Request, response: Response, payload: MfaLoginRequest, db: AsyncSession = Depends(get_db)):
    user_id = _decode_or_401(
        payload.mfa_pending_token, TokenType.MFA_PENDING, "That code has expired, please log in again"
    )

    user = await db.get(User, user_id)
    if user is None or not user.mfa_enabled or not user.mfa_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="That code has expired, please log in again")

    if not verify_totp_code(user.mfa_secret, payload.totp_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code")

    return await _issue_tokens(db, user, response)


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired, please log in again")

    record = await get_valid_refresh_token(db, raw_token)
    if record is None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired, please log in again")

    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired, please log in again")

    # Rotation: the old refresh token dies the moment a new one is issued.
    await revoke_refresh_token(db, record)
    return await _issue_tokens(db, user, response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_token:
        record = await get_valid_refresh_token(db, raw_token)
        if record is not None:
            await revoke_refresh_token(db, record)
    _clear_refresh_cookie(response)
    return None


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Google Sign-In
# ---------------------------------------------------------------------------


@router.post("/google")
@limiter.limit("10/minute")
async def google_login(request: Request, response: Response, payload: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google Sign-In is not configured on the server")

    try:
        claims = google_id_token.verify_oauth2_token(
            payload.id_token, google_requests.Request(), settings.google_client_id
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired Google credential")

    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential")

    email = claims.get("email")
    if not email or not claims.get("email_verified", False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google did not provide a verified email")

    google_sub = claims["sub"]

    result = await db.execute(select(User).where(User.google_id == google_sub))
    user = result.scalars().first()

    if user is None:
        user = await get_user_by_email(db, email)

    if user is None:
        user = User(
            email=email,
            hashed_password=None,
            google_id=google_sub,
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif user.google_id is None:
        # Existing password account signing in with Google for the first time - link it.
        user.google_id = google_sub
        user.is_verified = True
        await db.commit()

    if user.mfa_enabled:
        pending_token = create_mfa_pending_token(user.id)
        return MfaRequiredResponse(mfa_pending_token=pending_token)

    return await _issue_tokens(db, user, response)


# ---------------------------------------------------------------------------
# MFA management (requires an authenticated session)
# ---------------------------------------------------------------------------


@router.post("/mfa/setup", response_model=MfaSetupResponse)
async def mfa_setup(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    secret = generate_totp_secret()
    user.mfa_secret_pending = secret
    await db.commit()

    provisioning_uri = get_provisioning_uri(secret, user.email)
    qr_code_data_uri = generate_qr_code_data_uri(provisioning_uri)
    return MfaSetupResponse(provisioning_uri=provisioning_uri, qr_code_data_uri=qr_code_data_uri)


@router.post("/mfa/verify")
async def mfa_verify(
    payload: MfaVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.mfa_secret_pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start MFA setup first")

    if not verify_totp_code(user.mfa_secret_pending, payload.totp_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code")

    user.mfa_secret = user.mfa_secret_pending
    user.mfa_secret_pending = None
    user.mfa_enabled = True
    await db.commit()
    return {"mfa_enabled": True}


@router.post("/mfa/disable")
async def mfa_disable(
    payload: MfaVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.mfa_enabled or not user.mfa_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA is not enabled")

    if not verify_totp_code(user.mfa_secret, payload.totp_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code")

    user.mfa_enabled = False
    user.mfa_secret = None
    await db.commit()
    return {"mfa_enabled": False}
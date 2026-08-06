import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.deps import get_current_user
from app.core.email import send_verification_email
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
    create_email_verification_token,
    create_mfa_pending_token,
    decode_token,
    verify_password,
)
from app.crud.refresh_token import (
    get_valid_refresh_token,
    issue_refresh_token,
    revoke_all_for_user,
    revoke_refresh_token,
)
from app.crud.user import (
    create_google_user,
    create_user,
    get_user_by_email,
    get_user_by_google_id,
    get_user_by_id,
    link_google_id,
    mark_verified,
)
from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    MfaLoginRequest,
    MfaRequiredResponse,
    MfaSetupResponse,
    MfaVerifyRequest,
    RefreshRequest,
    ResendVerificationRequest,
    TokenPair,
    UserOut,
    UserRegister,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


async def _send_verification(user: User) -> None:
    token = create_email_verification_token(user.id)
    await send_verification_email(user.email, token)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
async def register(request: Request, payload: UserRegister, db: AsyncSession = Depends(get_db)) -> User:
    existing = await get_user_by_email(db, payload.email)
    if existing is not None:
        # Deliberately vague to avoid leaking which emails are registered.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Registration failed")
    user = await create_user(db, payload.email, payload.password)
    await _send_verification(user)
    return user


@router.post("/verify-email", response_model=UserOut)
@limiter.limit("10/hour")
async def verify_email(request: Request, payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)) -> User:
    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="This verification link is invalid or has expired"
    )
    try:
        token_payload = decode_token(payload.token)
    except JWTError:
        raise invalid
    if token_payload.get("type") != TokenType.EMAIL_VERIFY.value:
        raise invalid

    try:
        user = await get_user_by_id(db, uuid.UUID(token_payload["sub"]))
    except (KeyError, ValueError):
        raise invalid
    if user is None:
        raise invalid

    if not user.is_verified:
        user = await mark_verified(db, user)
    return user


@router.post("/resend-verification", response_model=MessageResponse)
@limiter.limit("3/hour")
async def resend_verification(
    request: Request, payload: ResendVerificationRequest, db: AsyncSession = Depends(get_db)
) -> MessageResponse:
    # Always return the same generic message, whether or not the account
    # exists or is already verified, so this endpoint can't be used to probe
    # which emails are registered.
    generic = MessageResponse(message="If that account exists and isn't verified yet, a new link has been sent.")

    user = await get_user_by_email(db, payload.email)
    if user is not None and not user.is_verified:
        await _send_verification(user)
    return generic


@router.post("/google", response_model=TokenPair | MfaRequiredResponse)
@limiter.limit("10/minute")
async def google_auth(request: Request, payload: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured")

    try:
        claims = google_id_token.verify_oauth2_token(
            payload.id_token, google_requests.Request(), settings.google_client_id
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential")

    if not claims.get("email_verified", False):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified")

    google_id = claims["sub"]
    email = claims["email"]

    user = await get_user_by_google_id(db, google_id)
    if user is None:
        # No account linked to this Google ID yet - check if there's an
        # existing password account with the same email and link it instead
        # of creating a duplicate.
        user = await get_user_by_email(db, email)
        if user is not None:
            user = await link_google_id(db, user, google_id)
        else:
            user = await create_google_user(db, email, google_id)

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    if user.mfa_enabled:
        return MfaRequiredResponse(mfa_pending_token=create_mfa_pending_token(user.id))

    return await _issue_token_pair(db, user)


async def _issue_token_pair(db: AsyncSession, user: User) -> TokenPair:
    access_token = create_access_token(user.id)
    refresh_token = await issue_refresh_token(db, user.id)
    return TokenPair(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenPair | MfaRequiredResponse)
@limiter.limit("10/minute")
async def login(request: Request, payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, payload.email)
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if user is None or user.hashed_password is None or not verify_password(payload.password, user.hashed_password):
        raise invalid
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in. Check your inbox, or use resend-verification.",
        )

    if user.mfa_enabled:
        return MfaRequiredResponse(mfa_pending_token=create_mfa_pending_token(user.id))

    return await _issue_token_pair(db, user)


@router.post("/mfa/login", response_model=TokenPair)
@limiter.limit("10/minute")
async def mfa_login(request: Request, payload: MfaLoginRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired MFA challenge")
    try:
        token_payload = decode_token(payload.mfa_pending_token)
    except JWTError:
        raise invalid
    if token_payload.get("type") != TokenType.MFA_PENDING.value:
        raise invalid

    user = await get_user_by_id(db, uuid.UUID(token_payload["sub"]))
    if user is None or not user.mfa_enabled or not user.mfa_secret:
        raise invalid
    if not verify_totp_code(user.mfa_secret, payload.totp_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication code")

    return await _issue_token_pair(db, user)


@router.post("/refresh", response_model=TokenPair)
@limiter.limit("30/minute")
async def refresh(request: Request, payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    try:
        token_payload = decode_token(payload.refresh_token)
    except JWTError:
        raise invalid
    if token_payload.get("type") != TokenType.REFRESH.value:
        raise invalid

    record = await get_valid_refresh_token(db, payload.refresh_token)
    if record is None:
        raise invalid

    user = await get_user_by_id(db, record.user_id)
    if user is None or not user.is_active:
        raise invalid

    # Rotate: revoke the used refresh token and issue a fresh pair. Rotation
    # means a stolen-and-replayed refresh token is only usable once.
    await revoke_refresh_token(db, record)
    return await _issue_token_pair(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> None:
    record = await get_valid_refresh_token(db, payload.refresh_token)
    if record is not None:
        await revoke_refresh_token(db, record)


@router.post("/logout/all", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def logout_all(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    await revoke_all_for_user(db, user.id)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> User:
    return user


# --- MFA enrollment (requires an already-authenticated, logged-in user) ---


@router.post("/mfa/setup", response_model=MfaSetupResponse)
async def mfa_setup(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> MfaSetupResponse:
    if user.mfa_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA is already enabled")

    secret = generate_totp_secret()
    user.mfa_secret_pending = secret
    await db.commit()

    uri = get_provisioning_uri(secret, user.email)
    return MfaSetupResponse(provisioning_uri=uri, qr_code_data_uri=generate_qr_code_data_uri(uri))


@router.post("/mfa/verify", response_model=UserOut)
async def mfa_verify(
    payload: MfaVerifyRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> User:
    if not user.mfa_secret_pending:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No MFA setup in progress")
    if not verify_totp_code(user.mfa_secret_pending, payload.totp_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code")

    user.mfa_secret = user.mfa_secret_pending
    user.mfa_secret_pending = None
    user.mfa_enabled = True
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/mfa/disable", response_model=UserOut)
async def mfa_disable(
    payload: MfaVerifyRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> User:
    if not user.mfa_enabled or not user.mfa_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA is not enabled")
    if not verify_totp_code(user.mfa_secret, payload.totp_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication code")

    user.mfa_enabled = False
    user.mfa_secret = None
    await db.commit()
    await db.refresh(user)
    return user

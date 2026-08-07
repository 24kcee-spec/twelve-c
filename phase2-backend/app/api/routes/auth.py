import base64
import json
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import jwt

from app.database import get_db
from app.models.user import User
from app.core.security import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM

router = APIRouter()

class GoogleLoginRequest(BaseModel):
    credential: str

@router.get("/me")
@router.get("/auth/me")
async def get_me(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = auth_header.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return {
        "id": str(getattr(user, "id", "1")),
        "email": user.email,
        "full_name": getattr(user, "full_name", ""),
        "is_verified": True
    }

@router.post("/login")
@router.post("/auth/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalars().first()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.is_verified:
        user.is_verified = True
        await db.commit()

    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/google")
@router.post("/auth/google")
async def google_login(
    data: GoogleLoginRequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        payload_b64 = data.credential.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        decoded_bytes = base64.b64decode(payload_b64)
        google_data = json.loads(decoded_bytes)
        email = google_data.get("email")
        full_name = google_data.get("name", "")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Google token format")

    if not email:
        raise HTTPException(status_code=400, detail="Email not provided by Google")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalars().first()

    if not user:
        random_pass = secrets.token_hex(16)
        user = User(
            email=email,
            hashed_password=get_password_hash(random_pass),
            full_name=full_name,
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}
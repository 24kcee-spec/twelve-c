from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.crud import business as business_crud
from app.database import get_db
from app.models.user import User
from app.schemas.business import BusinessCreate, BusinessOut, BusinessUpdate

router = APIRouter(prefix="/businesses", tags=["businesses"])
logger = logging.getLogger("twelvec")


async def _get_owned_business_or_404(db: AsyncSession, user: User, business_id: uuid.UUID):
    business = await business_crud.get_business(db, user.id, business_id)
    if business is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")
    return business


@router.post("", response_model=BusinessOut, status_code=status.HTTP_201_CREATED)
async def create_business(
    payload: BusinessCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await business_crud.create_business(db, user.id, payload)


@router.get("", response_model=list[BusinessOut])
async def list_businesses(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await business_crud.list_businesses(db, user.id)


@router.get("/{business_id}", response_model=BusinessOut)
async def get_business(
    business_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await _get_owned_business_or_404(db, user, business_id)


@router.patch("/{business_id}", response_model=BusinessOut)
async def update_business(
    business_id: uuid.UUID,
    payload: BusinessUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    business = await _get_owned_business_or_404(db, user, business_id)
    return await business_crud.update_business(db, business, payload)


@router.delete("/{business_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_business(
    business_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    business = await _get_owned_business_or_404(db, user, business_id)
    try:
        await business_crud.delete_business(db, business)
    except IntegrityError:
        await db.rollback()
        logger.exception("Business deletion blocked by a foreign key constraint for business %s", business_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Couldn't delete this business because some linked data is still attached. Please try again.",
        )

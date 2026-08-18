from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.crud import business as business_crud
from app.crud import qpd_calculation as qpd_crud
from app.database import get_db
from app.models.user import User
from app.schemas.qpd_calculation import (
    ApplyPaymentsRequest,
    ConfirmActualPaymentRequest,
    QpdCalculationCreate,
    QpdCalculationOut,
)

router = APIRouter(prefix="/businesses/{business_id}/qpd-calculations", tags=["qpd-calculations"])


async def _get_owned_business_or_404(db: AsyncSession, user: User, business_id: uuid.UUID):
    business = await business_crud.get_business(db, user.id, business_id)
    if business is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")
    return business


@router.post("", response_model=QpdCalculationOut, status_code=status.HTTP_201_CREATED)
async def create_calculation(
    business_id: uuid.UUID,
    payload: QpdCalculationCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    business = await _get_owned_business_or_404(db, user, business_id)
    return await qpd_crud.create_calculation(db, business, payload)


@router.get("", response_model=list[QpdCalculationOut])
async def list_calculations(
    business_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _get_owned_business_or_404(db, user, business_id)
    return await qpd_crud.list_calculations(db, business_id)


@router.get("/{calculation_id}", response_model=QpdCalculationOut)
async def get_calculation(
    business_id: uuid.UUID,
    calculation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_business_or_404(db, user, business_id)
    record = await qpd_crud.get_calculation(db, business_id, calculation_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calculation not found")
    return record


@router.post("/{calculation_id}/payments", response_model=QpdCalculationOut)
async def apply_payments(
    business_id: uuid.UUID,
    calculation_id: uuid.UUID,
    payload: ApplyPaymentsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_business_or_404(db, user, business_id)
    record = await qpd_crud.get_calculation(db, business_id, calculation_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calculation not found")
    return await qpd_crud.apply_payments_to_calculation(db, record, payload)


@router.post("/{calculation_id}/confirm-payment", response_model=QpdCalculationOut)
async def confirm_actual_payment(
    business_id: uuid.UUID,
    calculation_id: uuid.UUID,
    payload: ConfirmActualPaymentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Records what was genuinely remitted to ZIMRA for this quarter. Call
    this after the person actually pays via TaRMS - it's what the next
    quarter's calculation nets its cumulative amount against, so an
    unconfirmed quarter (still holding its seeded estimate) can silently
    understate what's owed next quarter if it wasn't paid in full.
    """
    await _get_owned_business_or_404(db, user, business_id)
    record = await qpd_crud.get_calculation(db, business_id, calculation_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calculation not found")
    return await qpd_crud.confirm_actual_payment(db, record, payload)


@router.delete("/{calculation_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_calculation(
    business_id: uuid.UUID,
    calculation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_business_or_404(db, user, business_id)
    record = await qpd_crud.get_calculation(db, business_id, calculation_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calculation not found")
    await qpd_crud.delete_calculation(db, record)
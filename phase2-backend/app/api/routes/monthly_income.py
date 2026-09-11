from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.businesses import _get_owned_business_or_404
from app.core.deps import get_current_user
from app.crud import monthly_income as monthly_income_crud
from app.database import get_db
from app.models.user import User
from app.schemas.monthly_income import MonthlyIncomeEntryOut, MonthlyIncomeUpsertRequest

router = APIRouter(prefix="/businesses/{business_id}/monthly-income", tags=["monthly-income"])


@router.get("/{tax_year}", response_model=list[MonthlyIncomeEntryOut])
async def get_monthly_income(
    business_id: uuid.UUID,
    tax_year: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Whatever this business already has saved for tax_year - the
    frontend uses this to carry actual months forward instead of asking
    for Jan/Feb again when filing QPD2 in June."""
    await _get_owned_business_or_404(db, user, business_id)
    return await monthly_income_crud.list_monthly_income(db, business_id, tax_year)


@router.put("/{tax_year}", response_model=list[MonthlyIncomeEntryOut])
async def upsert_monthly_income(
    business_id: uuid.UUID,
    tax_year: int,
    payload: MonthlyIncomeUpsertRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_business_or_404(db, user, business_id)
    return await monthly_income_crud.upsert_monthly_income(db, business_id, tax_year, payload.entries)
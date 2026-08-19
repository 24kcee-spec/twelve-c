from __future__ import annotations

import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.businesses import _get_owned_business_or_404
from app.core.deps import get_current_user
from app.crud import capital_asset as asset_crud
from app.database import get_db
from app.models.user import User
from app.schemas.capital_asset import CapitalAllowanceTotals, CapitalAssetCreate, CapitalAssetOut

router = APIRouter(prefix="/businesses/{business_id}/assets", tags=["capital-assets"])


@router.post("", response_model=CapitalAssetOut, status_code=status.HTTP_201_CREATED)
async def create_asset(
    business_id: uuid.UUID,
    payload: CapitalAssetCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_business_or_404(db, user, business_id)
    return await asset_crud.create_asset(db, business_id, payload)


@router.get("", response_model=list[CapitalAssetOut])
async def list_assets(
    business_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _get_owned_business_or_404(db, user, business_id)
    return await asset_crud.list_assets(db, business_id)


@router.get("/allowance", response_model=CapitalAllowanceTotals)
async def get_allowance_totals(
    business_id: uuid.UUID,
    tax_year: int = Query(default_factory=lambda: datetime.date.today().year, ge=2000, le=2100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The register's total claimable capital allowance for one tax year, in
    both currencies - the number a person can then paste (or, on the
    frontend, click to apply) into a calculation's capital_allowances
    field. Never written automatically; see capital_allowances.py's
    module docstring.
    """
    await _get_owned_business_or_404(db, user, business_id)
    total_usd, total_zig = await asset_crud.compute_allowance_totals(db, business_id, tax_year)
    return CapitalAllowanceTotals(tax_year=tax_year, total_allowance_usd=total_usd, total_allowance_zig=total_zig)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_asset(
    business_id: uuid.UUID,
    asset_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_owned_business_or_404(db, user, business_id)
    asset = await asset_crud.get_asset(db, business_id, asset_id)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    await asset_crud.delete_asset(db, asset)
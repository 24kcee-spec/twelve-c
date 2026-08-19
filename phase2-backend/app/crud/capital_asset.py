from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.capital_asset import CapitalAsset
from app.schemas.capital_asset import CapitalAssetCreate
from engine.zimra_qpd.capital_allowances import AssetCategory as EngineAssetCategory
from engine.zimra_qpd.capital_allowances import CapitalAsset as EngineCapitalAsset
from engine.zimra_qpd.capital_allowances import compute_total_capital_allowances


async def create_asset(db: AsyncSession, business_id: uuid.UUID, data: CapitalAssetCreate) -> CapitalAsset:
    asset = CapitalAsset(business_id=business_id, **data.model_dump(exclude={"category"}), category=data.category.value)
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


async def list_assets(db: AsyncSession, business_id: uuid.UUID) -> list[CapitalAsset]:
    result = await db.execute(
        select(CapitalAsset).where(CapitalAsset.business_id == business_id).order_by(CapitalAsset.created_at)
    )
    return list(result.scalars())


async def get_asset(db: AsyncSession, business_id: uuid.UUID, asset_id: uuid.UUID) -> CapitalAsset | None:
    result = await db.execute(
        select(CapitalAsset).where(CapitalAsset.id == asset_id, CapitalAsset.business_id == business_id)
    )
    return result.scalar_one_or_none()


async def delete_asset(db: AsyncSession, asset: CapitalAsset) -> None:
    await db.delete(asset)
    await db.commit()


async def compute_allowance_totals(
    db: AsyncSession, business_id: uuid.UUID, tax_year: int
) -> tuple[float, float]:
    """
    Returns (total_allowance_usd, total_allowance_zig) claimable for
    tax_year across the whole register, by running the pure engine
    function once per currency leg (the engine's CapitalAsset only
    carries a single `cost`, so USD and ZiG legs are computed separately
    and never mixed).
    """
    assets = await list_assets(db, business_id)

    usd_assets = [
        EngineCapitalAsset(
            description=a.description,
            category=EngineAssetCategory(a.category),
            cost=a.cost_usd,
            year_acquired=a.year_acquired,
            elect_sia=a.elect_sia,
        )
        for a in assets
        if a.cost_usd > 0
    ]
    zig_assets = [
        EngineCapitalAsset(
            description=a.description,
            category=EngineAssetCategory(a.category),
            cost=a.cost_zig,
            year_acquired=a.year_acquired,
            elect_sia=a.elect_sia,
        )
        for a in assets
        if a.cost_zig > 0
    ]

    total_usd = compute_total_capital_allowances(usd_assets, tax_year)
    total_zig = compute_total_capital_allowances(zig_assets, tax_year)
    return total_usd, total_zig
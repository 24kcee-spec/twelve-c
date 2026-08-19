$path = "app/models/capital_asset.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CapitalAsset(Base):
    """
    One fixed asset on a business's capital allowance / wear-and-tear
    register. Assets persist independently of any single QpdCalculation -
    they're acquired once and claimed against year after year, so they
    live on the business, not on a calculation.

    The claimable amount for a given tax year is NOT stored here; it's
    computed on demand from (cost, category, year_acquired, elect_sia) via
    engine.zimra_qpd.capital_allowances.compute_total_capital_allowances(),
    so re-verifying ZIMRA's rates later never requires a data migration.
    """

    __tablename__ = "capital_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )

    description: Mapped[str] = mapped_column(String(255), nullable=False)
    # Mirrors capital_allowances.AssetCategory: commercial_building,
    # industrial_farm_building, motor_vehicle, machinery_other.
    category: Mapped[str] = mapped_column(String(64), nullable=False)

    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_zig: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    year_acquired: Mapped[int] = mapped_column(Integer, nullable=False)
    elect_sia: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    business: Mapped["Business"] = relationship(back_populates="capital_assets")  # noqa: F821
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "app/models/business.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Business(Base):
    """
    One taxable entity belonging to a user. A user can own several (the
    handoff notes the real user runs more than one entity), each with its
    own default exchange rate / rate assumptions so re-entering them every
    quarter isn't necessary.
    """

    __tablename__ = "businesses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Defaults only - each QpdCalculation stores the actual values used, so
    # changing a default here never rewrites historical calculations.
    default_exchange_rate: Mapped[float] = mapped_column(Float, default=26.8, nullable=False)
    default_tax_rate: Mapped[float] = mapped_column(Float, default=0.25, nullable=False)
    default_aids_levy_rate: Mapped[float] = mapped_column(Float, default=0.03, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship(back_populates="businesses")  # noqa: F821
    calculations: Mapped[list["QpdCalculation"]] = relationship(  # noqa: F821
        back_populates="business", cascade="all, delete-orphan"
    )
    capital_assets: Mapped[list["CapitalAsset"]] = relationship(  # noqa: F821
        back_populates="business", cascade="all, delete-orphan"
    )
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "app/models/__init__.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
from app.models.business import Business
from app.models.capital_asset import CapitalAsset
from app.models.qpd_calculation import QpdCalculation
from app.models.refresh_token import RefreshToken
from app.models.user import User

__all__ = ["User", "Business", "QpdCalculation", "RefreshToken", "CapitalAsset"]
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "app/schemas/capital_asset.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class AssetCategory(str, Enum):
    COMMERCIAL_BUILDING = "commercial_building"
    INDUSTRIAL_FARM_BUILDING = "industrial_farm_building"
    MOTOR_VEHICLE = "motor_vehicle"
    MACHINERY_OTHER = "machinery_other"


class CapitalAssetCreate(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    category: AssetCategory
    cost_usd: float = Field(default=0.0, ge=0)
    cost_zig: float = Field(default=0.0, ge=0)
    year_acquired: int = Field(ge=2000, le=2100)
    elect_sia: bool = False


class CapitalAssetOut(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    description: str
    category: AssetCategory
    cost_usd: float
    cost_zig: float
    year_acquired: int
    elect_sia: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CapitalAllowanceTotals(BaseModel):
    """Sum of one tax year's claimable allowance across the whole register."""

    tax_year: int
    total_allowance_usd: float
    total_allowance_zig: float
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "app/crud/capital_asset.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
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
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "app/api/routes/assets.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
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
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "app/main.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.api.routes import assets, auth, businesses, qpd
from app.config import get_settings
from app.core.limiter import limiter

settings = get_settings()

app = FastAPI(title="TwelveC API")

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again shortly."})


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(businesses.router, tags=["businesses"])
app.include_router(qpd.router, tags=["qpd-calculations"])
app.include_router(assets.router, tags=["capital-assets"])


@app.get("/")
def root():
    return {"status": "ok"}
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"
$path = "tests/test_capital_assets.py"
$fullPath = Join-Path -Path (Get-Location).ProviderPath -ChildPath $path
$content = @'
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

from tests.test_businesses_and_qpd import _auth_headers


async def _make_business(client, headers, name="Asset Co"):
    r = await client.post("/businesses", headers=headers, json={"name": name})
    return r.json()["id"]


async def test_asset_crud_and_ownership_isolation(client):
    headers_a = await _auth_headers(client, "assets-a@example.com")
    headers_b = await _auth_headers(client, "assets-b@example.com")
    business_id = await _make_business(client, headers_a)

    r = await client.post(
        f"/businesses/{business_id}/assets",
        headers=headers_a,
        json={
            "description": "Delivery van",
            "category": "motor_vehicle",
            "cost_usd": 20000,
            "cost_zig": 0,
            "year_acquired": 2025,
            "elect_sia": False,
        },
    )
    assert r.status_code == 201
    asset_id = r.json()["id"]

    # Owner B can't see or delete owner A's business's assets.
    r = await client.get(f"/businesses/{business_id}/assets", headers=headers_b)
    assert r.status_code == 404
    r = await client.delete(f"/businesses/{business_id}/assets/{asset_id}", headers=headers_b)
    assert r.status_code == 404

    r = await client.get(f"/businesses/{business_id}/assets", headers=headers_a)
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = await client.delete(f"/businesses/{business_id}/assets/{asset_id}", headers=headers_a)
    assert r.status_code == 204

    r = await client.get(f"/businesses/{business_id}/assets", headers=headers_a)
    assert r.json() == []


async def test_allowance_totals_wear_and_tear_vs_sia(client):
    headers = await _auth_headers(client, "assets-calc@example.com")
    business_id = await _make_business(client, headers)

    # Motor vehicle, wear & tear (20%/yr), acquired 2025 -> 2026 is year 1
    # since acquisition (index 1), still fully within the 5-year life.
    await client.post(
        f"/businesses/{business_id}/assets",
        headers=headers,
        json={
            "description": "Delivery van",
            "category": "motor_vehicle",
            "cost_usd": 20000,
            "cost_zig": 0,
            "year_acquired": 2025,
            "elect_sia": False,
        },
    )
    # Machinery, SIA elected (25%/yr for 4 years), acquired 2026.
    await client.post(
        f"/businesses/{business_id}/assets",
        headers=headers,
        json={
            "description": "Packaging line",
            "category": "machinery_other",
            "cost_usd": 0,
            "cost_zig": 100000,
            "year_acquired": 2026,
            "elect_sia": True,
        },
    )

    r = await client.get(f"/businesses/{business_id}/assets/allowance?tax_year=2026", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["tax_year"] == 2026
    # 20000 * 20% = 4000 (wear & tear, year 1 since acquisition)
    assert body["total_allowance_usd"] == pytest.approx(4000.0)
    # 100000 * 25% = 25000 (SIA, year of acquisition)
    assert body["total_allowance_zig"] == pytest.approx(25000.0)
'@
$content = $content -replace 'MIDDOTTOKEN', [char]0x00B7 -replace 'EMDASHTOKEN', [char]0x2014 -replace 'ENDASHTOKEN', [char]0x2013
[System.IO.File]::WriteAllText($fullPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $path"

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
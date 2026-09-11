from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class MonthlyIncomeEntryIn(BaseModel):
    month: int = Field(ge=1, le=12)
    usd_amount: float = Field(default=0.0, ge=0)
    zig_amount: float = Field(default=0.0, ge=0)
    is_estimate: bool = False


class MonthlyIncomeUpsertRequest(BaseModel):
    """Bulk save - the frontend sends every month it currently has filled
    in (usually all of them) in one call rather than one request per
    month box."""

    tax_year: int = Field(ge=2000, le=2100)
    entries: list[MonthlyIncomeEntryIn] = Field(max_length=12)


class MonthlyIncomeEntryOut(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    tax_year: int
    month: int
    usd_amount: float
    zig_amount: float
    is_estimate: bool
    updated_at: datetime

    model_config = {"from_attributes": True}
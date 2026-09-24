from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from zimra_qpd.tax_rules import DEFAULT_TAX_RULES


class BusinessCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    default_exchange_rate: float = Field(default=26.8, gt=0)
    default_tax_rate: float = Field(default=float(DEFAULT_TAX_RULES.corporate_tax_rate), ge=0, le=1)
    default_aids_levy_rate: float = Field(default=float(DEFAULT_TAX_RULES.aids_levy_rate), ge=0, le=1)


class BusinessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    default_exchange_rate: float | None = Field(default=None, gt=0)
    default_tax_rate: float | None = Field(default=None, ge=0, le=1)
    default_aids_levy_rate: float | None = Field(default=None, ge=0, le=1)


class BusinessOut(BaseModel):
    id: uuid.UUID
    name: str
    default_exchange_rate: float
    default_tax_rate: float
    default_aids_levy_rate: float
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

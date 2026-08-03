from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CurrencyExpensesIn(BaseModel):
    cost_of_sales: float = Field(default=0.0, ge=0)
    salaries: float = Field(default=0.0, ge=0)
    other_expenses: float = Field(default=0.0, ge=0)
    capital_allowances: float = Field(default=0.0, ge=0)


class QpdCalculationCreate(BaseModel):
    tax_year: int = Field(ge=2000, le=2100)
    quarter_label: str = Field(min_length=1, max_length=64)

    usd_sales: float = Field(ge=0)
    zig_sales: float = Field(ge=0)
    usd_expenses: CurrencyExpensesIn = Field(default_factory=CurrencyExpensesIn)
    zig_expenses: CurrencyExpensesIn = Field(default_factory=CurrencyExpensesIn)

    # Optional overrides - if omitted, the business's defaults are used.
    exchange_rate: float | None = Field(default=None, gt=0)
    tax_rate: float | None = Field(default=None, ge=0, le=1)
    aids_levy_rate: float | None = Field(default=None, ge=0, le=1)


class QpdInstalmentOut(BaseModel):
    label: str
    percentage: float
    usd: float
    zig: float
    usd_paid: float
    zig_paid: float
    usd_balance: float
    zig_balance: float


class QpdCalculationOut(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    tax_year: int
    quarter_label: str
    input_json: dict
    result_json: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class ApplyPaymentsRequest(BaseModel):
    usd_paid: list[float] = Field(min_length=4, max_length=4)
    zig_paid: list[float] = Field(min_length=4, max_length=4)

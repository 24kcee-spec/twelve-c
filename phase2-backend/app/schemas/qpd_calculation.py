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
    tax_year: int
    quarter_label: str = Field(min_length=1, max_length=64)

    # Which QPD this calculation is FOR (1=March, 2=June, 3=September,
    # 4=December) - drives the engine's cumulative-percentage lookup.
    # Defaults to 1 so older callers/tests that never sent this keep working.
    quarter: int = Field(default=1, ge=1, le=4)

    usd_sales: float = Field(ge=0)
    zig_sales: float = Field(ge=0)
    usd_expenses: CurrencyExpensesIn = Field(default_factory=CurrencyExpensesIn)
    zig_expenses: CurrencyExpensesIn = Field(default_factory=CurrencyExpensesIn)

    # None -> fall back to the business's saved defaults (see crud._build_engine_input).
    exchange_rate: float | None = Field(default=None, gt=0)
    tax_rate: float | None = Field(default=None, ge=0, le=1)
    aids_levy_rate: float | None = Field(default=None, ge=0, le=1)

    # Leave both undefined/None to let the backend auto-sum this business's
    # CONFIRMED prior-quarter payments for this tax_year. Only pass these to
    # override that (e.g. correcting for a quarter calculated outside the app).
    previous_qpds_paid_usd: float | None = Field(default=None, ge=0)
    previous_qpds_paid_zig: float | None = Field(default=None, ge=0)

    # Prior-year assessed tax loss carried forward - reduces the taxable
    # BASE before tax is computed, not a credit against tax already computed.
    assessed_loss_usd: float = Field(default=0.0, ge=0)
    assessed_loss_zig: float = Field(default=0.0, ge=0)

    # Withholding tax already suffered this tax year (e.g. a client withheld
    # 30% for lack of an ITF263 tax clearance) - netted off the cumulative
    # amount due, the same way previous_qpds_paid is.
    withholding_credits_usd: float = Field(default=0.0, ge=0)
    withholding_credits_zig: float = Field(default=0.0, ge=0)


class QpdInstalmentOut(BaseModel):
    label: str
    percentage: float
    usd: float
    zig: float
    usd_paid: float
    zig_paid: float
    usd_balance: float
    zig_balance: float


class QpdResultJson(BaseModel):
    usd_ratio: float
    zig_ratio: float
    payment_ratio_usd: float
    payment_ratio_zig: float
    adjusted_income_usd: float
    adjusted_income_zig: float
    adjusted_deductions_usd: float
    adjusted_deductions_zig: float
    taxable_profit_usd: float
    taxable_profit_zig: float
    tax_payable_usd: float
    tax_payable_zig: float
    aids_levy_usd: float
    aids_levy_zig: float
    total_tax_usd: float
    total_tax_zig: float
    schedule: list[QpdInstalmentOut]

    # The actual amount owed THIS quarter - the headline figure. `schedule`
    # above is a full-year projection at the current estimate and is NOT
    # netted against what's already been paid; this block is.
    quarter: int
    due_date: str
    cumulative_percentage: float
    cumulative_due_usd: float
    cumulative_due_zig: float
    previous_paid_usd: float
    previous_paid_zig: float
    net_payable_usd: float
    net_payable_zig: float


class QpdCalculationOut(BaseModel):
    id: uuid.UUID
    business_id: uuid.UUID
    tax_year: int
    quarter_label: str
    quarter: int
    input_json: dict
    result_json: dict
    actual_usd_paid: float | None
    actual_zig_paid: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApplyPaymentsRequest(BaseModel):
    usd_paid: list[float] = Field(min_length=4, max_length=4)
    zig_paid: list[float] = Field(min_length=4, max_length=4)


class ConfirmActualPaymentRequest(BaseModel):
    actual_usd_paid: float = Field(ge=0)
    actual_zig_paid: float = Field(ge=0)

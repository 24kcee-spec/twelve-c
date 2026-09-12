from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from zimra_qpd.compliance import ComplianceStatus


class QuarterBreakdownOut(BaseModel):
    quarter: int
    quarter_label: str
    due_date: str
    has_calculation: bool
    calculation_id: uuid.UUID | None
    calculated_at: datetime | None

    projected_annual_profit_usd: float | None
    projected_annual_profit_zig: float | None
    total_projected_tax_usd: float | None
    total_projected_tax_zig: float | None
    cumulative_percentage: float | None
    required_cumulative_tax_usd: float | None
    required_cumulative_tax_zig: float | None
    previous_paid_usd: float | None
    previous_paid_zig: float | None
    net_due_usd: float | None
    net_due_zig: float | None
    actual_usd_paid: float | None
    actual_zig_paid: float | None

    model_config = {"from_attributes": True}


class ComplianceCheckOut(BaseModel):
    status: ComplianceStatus
    is_final: bool
    reference_tax: float
    total_remitted: float
    accuracy_ratio: float | None
    shortfall_to_90pct: float
    shortfall_to_95pct: float
    max_penalty_exposure: float
    message: str

    model_config = {"from_attributes": True}


class BusinessComplianceOut(BaseModel):
    business_id: uuid.UUID
    tax_year: int

    # False when no quarter has been calculated yet this tax year - in that
    # case usd/zig/overall_status are all None and the frontend should show
    # "nothing to assess yet" rather than a compliance verdict.
    has_data: bool
    overall_status: ComplianceStatus | None
    usd: ComplianceCheckOut | None
    zig: ComplianceCheckOut | None

    latest_calculated_quarter: int | None
    quarters_missing: list[int]
    quarters: list[QuarterBreakdownOut]

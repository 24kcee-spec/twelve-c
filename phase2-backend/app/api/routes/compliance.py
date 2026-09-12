from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.businesses import _get_owned_business_or_404
from app.core.deps import get_current_user
from app.crud import qpd_calculation as qpd_crud
from app.database import get_db
from app.models.user import User
from app.schemas.compliance import BusinessComplianceOut
from zimra_qpd.compliance import assess_accuracy_dual

router = APIRouter(prefix="/businesses/{business_id}/compliance", tags=["compliance"])


@router.get("", response_model=BusinessComplianceOut)
async def get_business_compliance(
    business_id: uuid.UUID,
    tax_year: int = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Section 72(11) 90% accuracy check for one business/tax_year, run
    against the CURRENT best estimate (the latest calculated quarter's
    total projected tax) - see zimra_qpd.compliance module docstring for
    why this is deliberately a "would currently be" early-warning signal,
    not the real year-end statutory verdict, until a final assessed
    liability figure exists somewhere in the schema (not yet built).

    USD and ZiG are always assessed and returned independently, per
    Section 37AA - never netted against each other, even in the
    convenience `overall_status` field (which is the WORSE of the two
    legs, never a blend).
    """
    business = await _get_owned_business_or_404(db, user, business_id)
    breakdown = await qpd_crud.get_tax_year_breakdown(db, business.id, tax_year)

    quarters_out = [
        {
            "quarter": q.quarter,
            "quarter_label": q.quarter_label,
            "due_date": q.due_date,
            "has_calculation": q.has_calculation,
            "calculation_id": q.calculation_id,
            "calculated_at": q.calculated_at,
            "projected_annual_profit_usd": q.projected_annual_profit_usd,
            "projected_annual_profit_zig": q.projected_annual_profit_zig,
            "total_projected_tax_usd": q.total_projected_tax_usd,
            "total_projected_tax_zig": q.total_projected_tax_zig,
            "cumulative_percentage": q.cumulative_percentage,
            "required_cumulative_tax_usd": q.required_cumulative_tax_usd,
            "required_cumulative_tax_zig": q.required_cumulative_tax_zig,
            "previous_paid_usd": q.previous_paid_usd,
            "previous_paid_zig": q.previous_paid_zig,
            "net_due_usd": q.net_due_usd,
            "net_due_zig": q.net_due_zig,
            "actual_usd_paid": q.actual_usd_paid,
            "actual_zig_paid": q.actual_zig_paid,
        }
        for q in breakdown.quarters
    ]

    if breakdown.latest_calculated_quarter is None:
        return BusinessComplianceOut(
            business_id=business.id,
            tax_year=tax_year,
            has_data=False,
            overall_status=None,
            usd=None,
            zig=None,
            latest_calculated_quarter=None,
            quarters_missing=breakdown.quarters_missing,
            quarters=quarters_out,
        )

    latest_row = next(
        q for q in breakdown.quarters if q.quarter == breakdown.latest_calculated_quarter
    )
    reference_tax_usd = latest_row.total_projected_tax_usd or 0.0
    reference_tax_zig = latest_row.total_projected_tax_zig or 0.0

    dual_check = assess_accuracy_dual(
        reference_tax_usd,
        reference_tax_zig,
        breakdown.total_remitted_usd,
        breakdown.total_remitted_zig,
        is_final=False,
    )

    return BusinessComplianceOut(
        business_id=business.id,
        tax_year=tax_year,
        has_data=True,
        overall_status=dual_check.overall_status,
        usd=dual_check.usd,
        zig=dual_check.zig,
        latest_calculated_quarter=breakdown.latest_calculated_quarter,
        quarters_missing=breakdown.quarters_missing,
        quarters=quarters_out,
    )

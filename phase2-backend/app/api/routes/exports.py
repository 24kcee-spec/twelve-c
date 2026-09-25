from __future__ import annotations

import re
import uuid
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.businesses import _get_owned_business_or_404
from app.core.deps import get_current_user
from app.crud.qpd_calculation import get_latest_calculations_by_quarter
from app.database import get_db
from app.models.qpd_calculation import QpdCalculation
from app.models.user import User
from zimra_qpd.tax_rules import get_tax_rules
from zimra_qpd.pdf_export import build_qpd_pdf
from zimra_qpd.xlsx_export import QuarterExportData, build_qpd_workbook

router = APIRouter(prefix="/businesses/{business_id}/export", tags=["export"])

# Anything that isn't safe (or sane) in a downloaded filename on Windows,
# macOS or Linux - mirrors the same intent as the frontend's
# generatePdf.ts:safeFileSegment(), kept independent since this runs
# server-side on the business name, not client-side on data already in
# the browser.
_UNSAFE_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|]')


def _safe_filename_segment(value: str) -> str:
    return _UNSAFE_FILENAME_CHARS.sub("", value).strip().replace(" ", "-") or "business"


def _build_quarter_export_data(
    latest_by_quarter: dict[int, QpdCalculation],
    tax_year: int,
) -> list[QuarterExportData]:
    rules = get_tax_rules(tax_year)
    quarters: list[QuarterExportData] = []
    for q in (1, 2, 3, 4):
        record = latest_by_quarter.get(q)
        if record is None:
            quarters.append(
                QuarterExportData(
                    quarter=q,
                    quarter_label=f"Q{q}",
                    due_date=rules.qpd_payment_dates[q],
                    has_calculation=False,
                )
            )
            continue
        quarters.append(
            QuarterExportData(
                quarter=q,
                quarter_label=record.quarter_label,
                due_date=record.result_json.get("due_date", rules.qpd_payment_dates[q]),
                has_calculation=True,
                input=record.input_json,
                result=record.result_json,
                actual_usd_paid=record.actual_usd_paid,
                actual_zig_paid=record.actual_zig_paid,
                payment_confirmed_at=record.payment_confirmed_at,
            )
        )
    return quarters


@router.get("/excel")
async def export_working_papers_excel(
    business_id: uuid.UUID,
    tax_year: int = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Downloads this business's tax_year as a Working Papers .xlsx - three
    sheets (Read Me, Inputs, Working Papers), with the currency-split,
    deductions, taxable-profit/tax and what-to-pay steps written as LIVE
    Excel formulas over this business's own saved figures. See
    zimra_qpd.xlsx_export module docstring for exactly what's a pulled
    input vs. a live formula, and why.
    """
    business = await _get_owned_business_or_404(db, user, business_id)
    latest_by_quarter = await get_latest_calculations_by_quarter(db, business.id, tax_year)
    quarters = _build_quarter_export_data(latest_by_quarter, tax_year)

    workbook = build_qpd_workbook(business.name, tax_year, quarters)
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    filename = f"{_safe_filename_segment(business.name)}-QPD-Working-Papers-{tax_year}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pdf")
async def export_working_papers_pdf(
    business_id: uuid.UUID,
    tax_year: int = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Downloads this business's tax_year as a professional, printable
    Working Papers PDF - a plain worked-example-style record (no
    Section 72(11) penalty-exposure framing; that was deliberately removed
    from the product's Reconciliation view, see HANDOVER, 22 Sep 2026).
    """
    business = await _get_owned_business_or_404(db, user, business_id)
    latest_by_quarter = await get_latest_calculations_by_quarter(db, business.id, tax_year)
    quarters = _build_quarter_export_data(latest_by_quarter, tax_year)

    generated_on = datetime.now().strftime("%d %B %Y")
    pdf_bytes = build_qpd_pdf(business.name, tax_year, quarters, generated_on=generated_on)

    filename = f"{_safe_filename_segment(business.name)}-QPD-Working-Papers-{tax_year}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

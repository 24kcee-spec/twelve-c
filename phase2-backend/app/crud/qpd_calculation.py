from __future__ import annotations

import dataclasses
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Business
from app.models.qpd_calculation import QpdCalculation
from app.schemas.qpd_calculation import (
    ApplyPaymentsRequest,
    ConfirmActualPaymentRequest,
    QpdCalculationCreate,
)
from zimra_qpd.calculator import (
    QUARTER_DUE_DATES,
    CurrencyExpenses,
    QpdInput,
    QpdInstalment,
    QpdResult,
    apply_payments,
    calculate_qpd,
)


async def _sum_actual_paid_before_quarter(
    db: AsyncSession, business_id: uuid.UUID, tax_year: int, quarter: int
) -> tuple[float, float]:
    """
    Sums CONFIRMED actual payments (actual_usd_paid/actual_zig_paid) for
    this business/tax_year across every quarter strictly before `quarter`.

    Deliberately does NOT fall back to result_json.net_payable_usd for
    unconfirmed quarters - an unconfirmed prior quarter has no reliable
    "what was actually paid" figure yet, and silently substituting the
    calculated-but-unpaid amount would let a skipped confirmation quietly
    understate what's still owed. Unconfirmed prior quarters are excluded
    from the sum; the frontend should surface that as "N unconfirmed prior
    quarter(s) - previous paid may be incomplete" rather than the backend
    guessing.
    """
    result = await db.execute(
        select(QpdCalculation).where(
            QpdCalculation.business_id == business_id,
            QpdCalculation.tax_year == tax_year,
            QpdCalculation.quarter < quarter,
        )
    )
    records = result.scalars().all()
    usd_total = sum(r.actual_usd_paid for r in records if r.actual_usd_paid is not None)
    zig_total = sum(r.actual_zig_paid for r in records if r.actual_zig_paid is not None)
    return float(usd_total), float(zig_total)


async def _build_engine_input(
    db: AsyncSession, business: Business, data: QpdCalculationCreate
) -> QpdInput:
    if data.previous_qpds_paid_usd is not None and data.previous_qpds_paid_zig is not None:
        prev_usd, prev_zig = data.previous_qpds_paid_usd, data.previous_qpds_paid_zig
    else:
        prev_usd, prev_zig = await _sum_actual_paid_before_quarter(
            db, business.id, data.tax_year, data.quarter
        )
        # An explicit override for one currency only still wins for that currency.
        if data.previous_qpds_paid_usd is not None:
            prev_usd = data.previous_qpds_paid_usd
        if data.previous_qpds_paid_zig is not None:
            prev_zig = data.previous_qpds_paid_zig

    return QpdInput(
        usd_sales=data.usd_sales,
        zig_sales=data.zig_sales,
        usd_expenses=CurrencyExpenses(**data.usd_expenses.model_dump()),
        zig_expenses=CurrencyExpenses(**data.zig_expenses.model_dump()),
        exchange_rate=data.exchange_rate or business.default_exchange_rate,
        tax_rate=data.tax_rate if data.tax_rate is not None else business.default_tax_rate,
        aids_levy_rate=(
            data.aids_levy_rate if data.aids_levy_rate is not None else business.default_aids_levy_rate
        ),
        quarter=data.quarter,
        previous_qpds_paid_usd=prev_usd,
        previous_qpds_paid_zig=prev_zig,
        assessed_loss_usd=data.assessed_loss_usd,
        assessed_loss_zig=data.assessed_loss_zig,
        withholding_credits_usd=data.withholding_credits_usd,
        withholding_credits_zig=data.withholding_credits_zig,
    )


def _schedule_to_dicts(schedule: list[QpdInstalment]) -> list[dict]:
    """
    Serializes QpdInstalment objects by hand, including usd_balance/zig_balance.
    dataclasses.asdict() drops those - they're @property, computed from
    usd/usd_paid, not real dataclass fields. Every caller that turns a
    schedule into result_json MUST go through this, or the balance fields
    silently disappear and the frontend sums undefined -> NaN.
    """
    return [
        {
            "label": i.label,
            "percentage": i.percentage,
            "usd": i.usd,
            "zig": i.zig,
            "usd_paid": i.usd_paid,
            "zig_paid": i.zig_paid,
            "usd_balance": i.usd_balance,
            "zig_balance": i.zig_balance,
        }
        for i in schedule
    ]


def _result_to_dict(result: QpdResult) -> dict:
    data = dataclasses.asdict(result)
    data["schedule"] = _schedule_to_dicts(result.schedule)
    return data


async def create_calculation(
    db: AsyncSession, business: Business, data: QpdCalculationCreate
) -> QpdCalculation:
    engine_input = await _build_engine_input(db, business, data)
    result = calculate_qpd(engine_input)

    record = QpdCalculation(
        business_id=business.id,
        tax_year=data.tax_year,
        quarter_label=data.quarter_label,
        quarter=data.quarter,
        input_json=dataclasses.asdict(engine_input),
        result_json=_result_to_dict(result),
        # Seeded to the calculated figure as a starting assumption - NOT a
        # confirmation of payment. The frontend should let the person
        # correct this once they've actually paid (partial payment, late
        # payment, TaRMS rounding, etc. all happen), via confirm_payment()
        # below. Until corrected, this is just "what we expect you'll pay".
        actual_usd_paid=result.net_payable_usd,
        actual_zig_paid=result.net_payable_zig,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def list_calculations(db: AsyncSession, business_id: uuid.UUID) -> list[QpdCalculation]:
    result = await db.execute(
        select(QpdCalculation)
        .where(QpdCalculation.business_id == business_id)
        .order_by(QpdCalculation.tax_year.desc(), QpdCalculation.created_at.desc())
    )
    return list(result.scalars())


async def get_calculation(db: AsyncSession, business_id: uuid.UUID, calc_id: uuid.UUID) -> QpdCalculation | None:
    result = await db.execute(
        select(QpdCalculation).where(
            QpdCalculation.id == calc_id, QpdCalculation.business_id == business_id
        )
    )
    return result.scalar_one_or_none()


async def apply_payments_to_calculation(
    db: AsyncSession, record: QpdCalculation, data: ApplyPaymentsRequest
) -> QpdCalculation:
    """
    Re-derives QpdInstalment objects from the stored schedule, applies
    payments via the engine's apply_payments(), then persists the updated
    schedule back into result_json.
    """
    schedule = [
        QpdInstalment(
            label=item["label"],
            percentage=item["percentage"],
            usd=item["usd"],
            zig=item["zig"],
            usd_paid=item.get("usd_paid", 0.0),
            zig_paid=item.get("zig_paid", 0.0),
        )
        for item in record.result_json["schedule"]
    ]
    updated_schedule = apply_payments(schedule, data.usd_paid, data.zig_paid)

    new_result_json = dict(record.result_json)
    new_result_json["schedule"] = _schedule_to_dicts(updated_schedule)
    record.result_json = new_result_json
    await db.commit()
    await db.refresh(record)
    return record


async def delete_calculation(db: AsyncSession, record: QpdCalculation) -> None:
    await db.delete(record)
    await db.commit()


async def confirm_actual_payment(
    db: AsyncSession, record: QpdCalculation, data: ConfirmActualPaymentRequest
) -> QpdCalculation:
    """
    Overwrites the seeded actual_usd_paid/actual_zig_paid with what the
    person confirms they genuinely remitted to ZIMRA. This is the figure
    every LATER quarter's auto-sum (_sum_actual_paid_before_quarter) reads,
    so correcting a real underpayment/overpayment here is what makes the
    next quarter's net_payable come out right.
    """
    record.actual_usd_paid = data.actual_usd_paid
    record.actual_zig_paid = data.actual_zig_paid
    await db.commit()
    await db.refresh(record)
    return record


# --- Step 2 of the TaRMS-guide compliance layer: per-quarter audit trail ---
# (see HANDOVER.md). Assembles the year's four QPD checkpoints into the
# same shape as the PDF's own worked example - this is pure read/assembly
# over data the app already stores; nothing new is persisted here.


@dataclasses.dataclass
class QuarterBreakdownRow:
    """
    One row of the worked-example table for a single quarter. `has_calculation`
    is False (and every money field is None) for a quarter the business
    hasn't run yet this tax year - due_date/quarter_label are still filled
    in from the engine's own schedule so the row is displayable either way.
    """

    quarter: int
    quarter_label: str
    due_date: str
    has_calculation: bool
    calculation_id: uuid.UUID | None
    calculated_at: datetime | None

    # ITF12C row 30 equivalent - the taxable profit the year's tax estimate
    # is computed on, at the time this quarter was calculated.
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

    # What's recorded against this quarter as actually remitted. NOTE: this
    # is whatever confirm_actual_payment() last set, OR the seeded
    # net-payable default if the person never confirmed it (see
    # QpdCalculation.actual_usd_paid docstring) - there is no field yet that
    # distinguishes "genuinely confirmed" from "still just the seeded
    # assumption." Treat these as provisional until a confirmation-date
    # field exists (flagged in HANDOVER.md Step 2/6).
    actual_usd_paid: float | None
    actual_zig_paid: float | None


@dataclasses.dataclass
class TaxYearBreakdown:
    business_id: uuid.UUID
    tax_year: int
    quarters: list[QuarterBreakdownRow]  # always exactly 4 rows, Q1..Q4 in order

    # Sum of actual_usd_paid/actual_zig_paid across every quarter that HAS a
    # calculation this tax year (missing quarters contribute nothing - they
    # are not assumed to be zero-liability, just not yet calculated). This
    # is the figure step 3 should feed into assess_accuracy_dual() as
    # total_remitted, alongside the same "provisional until confirmed"
    # caveat as the per-row fields above.
    total_remitted_usd: float
    total_remitted_zig: float

    quarters_missing: list[int]  # e.g. [3, 4] if only Q1/Q2 have been run
    latest_calculated_quarter: int | None  # highest quarter number with a calculation


def _row_from_calculation(record: QpdCalculation | None, quarter: int) -> QuarterBreakdownRow:
    if record is None:
        return QuarterBreakdownRow(
            quarter=quarter,
            quarter_label=f"Q{quarter}",
            due_date=QUARTER_DUE_DATES[quarter],
            has_calculation=False,
            calculation_id=None,
            calculated_at=None,
            projected_annual_profit_usd=None,
            projected_annual_profit_zig=None,
            total_projected_tax_usd=None,
            total_projected_tax_zig=None,
            cumulative_percentage=None,
            required_cumulative_tax_usd=None,
            required_cumulative_tax_zig=None,
            previous_paid_usd=None,
            previous_paid_zig=None,
            net_due_usd=None,
            net_due_zig=None,
            actual_usd_paid=None,
            actual_zig_paid=None,
        )

    result = record.result_json
    return QuarterBreakdownRow(
        quarter=quarter,
        quarter_label=record.quarter_label,
        # Read from the stored result, not QUARTER_DUE_DATES, so a row
        # always reflects what the engine actually returned at calc time -
        # falls back to the live schedule only if an old record predates
        # this field ever being stored.
        due_date=result.get("due_date", QUARTER_DUE_DATES[quarter]),
        has_calculation=True,
        calculation_id=record.id,
        calculated_at=record.created_at,
        projected_annual_profit_usd=result.get("taxable_profit_usd"),
        projected_annual_profit_zig=result.get("taxable_profit_zig"),
        total_projected_tax_usd=result.get("total_tax_usd"),
        total_projected_tax_zig=result.get("total_tax_zig"),
        cumulative_percentage=result.get("cumulative_percentage"),
        required_cumulative_tax_usd=result.get("cumulative_due_usd"),
        required_cumulative_tax_zig=result.get("cumulative_due_zig"),
        previous_paid_usd=result.get("previous_paid_usd"),
        previous_paid_zig=result.get("previous_paid_zig"),
        net_due_usd=result.get("net_payable_usd"),
        net_due_zig=result.get("net_payable_zig"),
        actual_usd_paid=record.actual_usd_paid,
        actual_zig_paid=record.actual_zig_paid,
    )


async def get_tax_year_breakdown(
    db: AsyncSession, business_id: uuid.UUID, tax_year: int
) -> TaxYearBreakdown:
    """
    Assembles the four-quarter audit trail for one business/tax_year, shaped
    like the ZIMRA guide's worked example: quarter, due date, projected
    annual profit, total projected tax, cumulative %, required cumulative
    tax, less cumulative paid previously, net due.

    If a quarter was recalculated more than once, the MOST RECENT run wins
    (by created_at) - older runs for the same quarter are superseded, not
    averaged or listed separately; they remain individually retrievable via
    list_calculations()/get_calculation() for anyone who needs the history.
    """
    result = await db.execute(
        select(QpdCalculation)
        .where(
            QpdCalculation.business_id == business_id,
            QpdCalculation.tax_year == tax_year,
        )
        .order_by(QpdCalculation.quarter.asc(), QpdCalculation.created_at.desc())
    )
    records = result.scalars().all()

    latest_by_quarter: dict[int, QpdCalculation] = {}
    for record in records:
        # First record seen per quarter wins, since the query is already
        # ordered created_at DESC within each quarter.
        latest_by_quarter.setdefault(record.quarter, record)

    rows = [_row_from_calculation(latest_by_quarter.get(q), q) for q in (1, 2, 3, 4)]

    total_remitted_usd = sum(
        r.actual_usd_paid for r in rows if r.has_calculation and r.actual_usd_paid is not None
    )
    total_remitted_zig = sum(
        r.actual_zig_paid for r in rows if r.has_calculation and r.actual_zig_paid is not None
    )

    quarters_missing = [r.quarter for r in rows if not r.has_calculation]
    calculated_quarters = [r.quarter for r in rows if r.has_calculation]
    latest_calculated_quarter = max(calculated_quarters) if calculated_quarters else None

    return TaxYearBreakdown(
        business_id=business_id,
        tax_year=tax_year,
        quarters=rows,
        total_remitted_usd=float(total_remitted_usd),
        total_remitted_zig=float(total_remitted_zig),
        quarters_missing=quarters_missing,
        latest_calculated_quarter=latest_calculated_quarter,
    )
from __future__ import annotations

import dataclasses
import uuid

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
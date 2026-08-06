from __future__ import annotations

import dataclasses
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Business
from app.models.qpd_calculation import QpdCalculation
from app.schemas.qpd_calculation import ApplyPaymentsRequest, QpdCalculationCreate
from zimra_qpd.calculator import (
    CurrencyExpenses,
    QpdInput,
    QpdInstalment,
    QpdResult,
    apply_payments,
    calculate_qpd,
)


def _build_engine_input(business: Business, data: QpdCalculationCreate) -> QpdInput:
    return QpdInput(
        usd_sales=data.usd_sales,
        zig_sales=data.zig_sales,
        usd_expenses=CurrencyExpenses(**data.usd_expenses.model_dump()),
        zig_expenses=CurrencyExpenses(**data.zig_expenses.model_dump()),
        exchange_rate=data.exchange_rate or business.default_exchange_rate,
        tax_rate=data.tax_rate or business.default_tax_rate,
        aids_levy_rate=(
            data.aids_levy_rate if data.aids_levy_rate is not None else business.default_aids_levy_rate
        ),
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
    engine_input = _build_engine_input(business, data)
    result = calculate_qpd(engine_input)

    record = QpdCalculation(
        business_id=business.id,
        tax_year=data.tax_year,
        quarter_label=data.quarter_label,
        input_json=dataclasses.asdict(engine_input),
        result_json=_result_to_dict(result),
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

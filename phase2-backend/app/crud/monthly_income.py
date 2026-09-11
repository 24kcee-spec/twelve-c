from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.monthly_income import MonthlyIncomeEntry
from app.schemas.monthly_income import MonthlyIncomeEntryIn


async def list_monthly_income(
    db: AsyncSession, business_id: uuid.UUID, tax_year: int
) -> list[MonthlyIncomeEntry]:
    result = await db.execute(
        select(MonthlyIncomeEntry)
        .where(MonthlyIncomeEntry.business_id == business_id, MonthlyIncomeEntry.tax_year == tax_year)
        .order_by(MonthlyIncomeEntry.month)
    )
    return list(result.scalars())


async def upsert_monthly_income(
    db: AsyncSession, business_id: uuid.UUID, tax_year: int, entries: list[MonthlyIncomeEntryIn]
) -> list[MonthlyIncomeEntry]:
    """Updates each given month in place if it already exists for this
    business/tax_year, otherwise inserts it. One commit for the whole
    batch rather than one per month."""
    existing = await list_monthly_income(db, business_id, tax_year)
    existing_by_month = {e.month: e for e in existing}

    for entry in entries:
        row = existing_by_month.get(entry.month)
        if row is not None:
            row.usd_amount = entry.usd_amount
            row.zig_amount = entry.zig_amount
            row.is_estimate = entry.is_estimate
        else:
            row = MonthlyIncomeEntry(
                business_id=business_id,
                tax_year=tax_year,
                month=entry.month,
                usd_amount=entry.usd_amount,
                zig_amount=entry.zig_amount,
                is_estimate=entry.is_estimate,
            )
            db.add(row)
            existing_by_month[entry.month] = row

    await db.commit()
    return await list_monthly_income(db, business_id, tax_year)
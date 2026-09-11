from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MonthlyIncomeEntry(Base):
    """
    One month's sales figure feeding the rolling-annual-estimate calculator
    on the New Calculation page. Persists independently of any single
    QpdCalculation - a business's Jan/Feb actuals entered while filing QPD1
    should still be there, unchanged, when filing QPD2 in June, so the
    frontend can carry them forward instead of asking for them twice.

    One row per (business_id, tax_year, month). `is_estimate` records
    whether the figure was entered as a projection (the current, still-open
    month) or an actual (a closed month) at the time it was saved - purely
    informational, it doesn't affect any calculation.
    """

    __tablename__ = "monthly_income_entries"
    __table_args__ = (UniqueConstraint("business_id", "tax_year", "month", name="uq_monthly_income_period"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )

    tax_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-12

    usd_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    zig_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_estimate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    business: Mapped["Business"] = relationship(back_populates="monthly_income_entries")  # noqa: F821
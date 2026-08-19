from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CapitalAsset(Base):
    """
    One fixed asset on a business's capital allowance / wear-and-tear
    register. Assets persist independently of any single QpdCalculation -
    they're acquired once and claimed against year after year, so they
    live on the business, not on a calculation.

    The claimable amount for a given tax year is NOT stored here; it's
    computed on demand from (cost, category, year_acquired, elect_sia) via
    engine.zimra_qpd.capital_allowances.compute_total_capital_allowances(),
    so re-verifying ZIMRA's rates later never requires a data migration.
    """

    __tablename__ = "capital_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )

    description: Mapped[str] = mapped_column(String(255), nullable=False)
    # Mirrors capital_allowances.AssetCategory: commercial_building,
    # industrial_farm_building, motor_vehicle, machinery_other.
    category: Mapped[str] = mapped_column(String(64), nullable=False)

    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    cost_zig: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    year_acquired: Mapped[int] = mapped_column(Integer, nullable=False)
    elect_sia: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    business: Mapped["Business"] = relationship(back_populates="capital_assets")  # noqa: F821
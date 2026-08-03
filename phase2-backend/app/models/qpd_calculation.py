from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# JSONB on Postgres (indexable, binary-stored); falls back to portable JSON
# on any other backend (e.g. SQLite in tests).
JSONVariant = JSON().with_variant(JSONB, "postgresql")


class QpdCalculation(Base):
    """
    One saved run of the engine for a business/quarter. `input_json` and
    `result_json` are the full dataclasses serialised to JSON - storing the
    complete input alongside the result means a calculation is reproducible
    and auditable even if the engine's internals evolve later, and means we
    never need a migration to add a new derived field to old records.
    """

    __tablename__ = "qpd_calculations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True
    )

    tax_year: Mapped[int] = mapped_column(Integer, nullable=False)
    quarter_label: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. "Q1", "Q2"

    input_json: Mapped[dict] = mapped_column(JSONVariant, nullable=False)
    result_json: Mapped[dict] = mapped_column(JSONVariant, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    business: Mapped["Business"] = relationship(back_populates="calculations")  # noqa: F821

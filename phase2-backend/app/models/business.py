from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Business(Base):
    """
    One taxable entity belonging to a user. A user can own several (the
    handoff notes the real user runs more than one entity), each with its
    own default exchange rate / rate assumptions so re-entering them every
    quarter isn't necessary.
    """

    __tablename__ = "businesses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Defaults only - each QpdCalculation stores the actual values used, so
    # changing a default here never rewrites historical calculations.
    default_exchange_rate: Mapped[float] = mapped_column(Float, default=26.8, nullable=False)
    default_tax_rate: Mapped[float] = mapped_column(Float, default=0.25, nullable=False)
    default_aids_levy_rate: Mapped[float] = mapped_column(Float, default=0.03, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User"] = relationship(back_populates="businesses")  # noqa: F821
    calculations: Mapped[list["QpdCalculation"]] = relationship(  # noqa: F821
        back_populates="business", cascade="all, delete-orphan"
    )

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Business
from app.schemas.business import BusinessCreate, BusinessUpdate


async def create_business(db: AsyncSession, owner_id: uuid.UUID, data: BusinessCreate) -> Business:
    business = Business(owner_id=owner_id, **data.model_dump())
    db.add(business)
    await db.commit()
    await db.refresh(business)
    return business


async def list_businesses(db: AsyncSession, owner_id: uuid.UUID) -> list[Business]:
    result = await db.execute(select(Business).where(Business.owner_id == owner_id).order_by(Business.created_at))
    return list(result.scalars())


async def get_business(db: AsyncSession, owner_id: uuid.UUID, business_id: uuid.UUID) -> Business | None:
    result = await db.execute(
        select(Business).where(Business.id == business_id, Business.owner_id == owner_id)
    )
    return result.scalar_one_or_none()


async def update_business(db: AsyncSession, business: Business, data: BusinessUpdate) -> Business:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(business, field, value)
    await db.commit()
    await db.refresh(business)
    return business


async def delete_business(db: AsyncSession, business: Business) -> None:
    await db.delete(business)
    await db.commit()

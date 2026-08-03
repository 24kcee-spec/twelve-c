from __future__ import annotations

import os
import sys
from pathlib import Path

# Point settings at an in-memory SQLite DB before anything imports app.config,
# so tests never touch Postgres. Async SQLite driver: aiosqlite.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DATABASE_URL_SYNC", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-not-for-production-use-only")
os.environ.setdefault("MFA_ISSUER_NAME", "ZIMRA QPD Calculator (test)")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core.limiter import limiter  # noqa: E402
from app.database import Base, get_db  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def _reset_rate_limiter():
    limiter.reset()
    yield
    limiter.reset()


@pytest_asyncio.fixture
async def db_engine():
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    session_maker = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.main import app

    session_maker = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_maker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()

import pytest
from httpx import ASGITransport, AsyncClient
pytestmark = pytest.mark.asyncio

VALID_PASSWORD = "Str0ngPassw0rd!"

async def test_cors_headers_survive_unhandled_exception(client, monkeypatch):
    """This is the exact bug from production: an unhandled exception must
    still come back with CORS headers, or the browser reports a CORS block
    instead of showing the real error. (raise_app_exceptions=False here to
    mimic real uvicorn behavior, where exceptions never reach the client.)"""
    from tests.conftest import SENT_CODES
    from app.crud import business as business_crud
    from app.main import app

    email = "cors-repro@example.com"
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    code = SENT_CODES[email]
    await client.post("/auth/verify-email", json={"email": email, "code": code})
    login = await client.post("/auth/login", json={"email": email, "password": VALID_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}", "Origin": "http://localhost:3000"}

    async def boom(*args, **kwargs):
        raise RuntimeError("simulated crash")

    monkeypatch.setattr(business_crud, "list_businesses", boom)

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac2:
        r = await ac2.get("/businesses", headers=headers)

    assert r.status_code == 500
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
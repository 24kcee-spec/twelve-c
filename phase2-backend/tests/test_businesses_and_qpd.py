from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

VALID_PASSWORD = "Str0ngPassw0rd!"


from tests.conftest import SENT_CODES

async def _auth_headers(client, email="biz@example.com"):
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    code = SENT_CODES[email]
    await client.post("/auth/verify-email", json={"email": email, "code": code})
    r = await client.post("/auth/login", json={"email": email, "password": VALID_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_business_crud_and_ownership_isolation(client):
    headers_a = await _auth_headers(client, "owner-a@example.com")
    headers_b = await _auth_headers(client, "owner-b@example.com")

    r = await client.post("/businesses", headers=headers_a, json={"name": "Acme Ltd"})
    assert r.status_code == 201
    business_id = r.json()["id"]

    # Owner B must not see or reach owner A's business.
    r = await client.get(f"/businesses/{business_id}", headers=headers_b)
    assert r.status_code == 404

    r = await client.get("/businesses", headers=headers_a)
    assert len(r.json()) == 1

    r = await client.patch(f"/businesses/{business_id}", headers=headers_a, json={"name": "Acme Holdings"})
    assert r.status_code == 200
    assert r.json()["name"] == "Acme Holdings"


async def test_qpd_calculation_matches_engine_and_supports_payments(client):
    headers = await _auth_headers(client)
    r = await client.post("/businesses", headers=headers, json={"name": "Test Co", "default_exchange_rate": 26.8})
    business_id = r.json()["id"]

    payload = {
        "tax_year": 2026,
        "quarter_label": "Q1",
        "usd_sales": 100000,
        "zig_sales": 500000,
        "usd_expenses": {"cost_of_sales": 30000, "salaries": 10000, "other_expenses": 5000, "capital_allowances": 2000},
        "zig_expenses": {"cost_of_sales": 100000, "salaries": 50000, "other_expenses": 20000, "capital_allowances": 0},
    }
    r = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    calc = r.json()
    assert calc["result_json"]["total_tax_usd"] > 0
    assert len(calc["result_json"]["schedule"]) == 4
    # 10/25/30/35 split of total_tax should reproduce the ZIMRA QPD schedule.
    total_usd = calc["result_json"]["total_tax_usd"]
    from decimal import Decimal, ROUND_HALF_UP
    expected_q1 = float(
        (Decimal(str(total_usd)) * Decimal("0.10")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    )
    assert calc["result_json"]["schedule"][0]["usd"] == expected_q1

    calc_id = calc["id"]
    pay_r = await client.post(
        f"/businesses/{business_id}/qpd-calculations/{calc_id}/payments",
        headers=headers,
        json={"usd_paid": [calc["result_json"]["schedule"][0]["usd"], 0, 0, 0], "zig_paid": [0, 0, 0, 0]},
    )
    assert pay_r.status_code == 200
    updated = pay_r.json()
    assert updated["result_json"]["schedule"][0]["usd_balance"] == 0


async def test_qpd_calculation_requires_ownership(client):
    headers_a = await _auth_headers(client, "qpd-a@example.com")
    headers_b = await _auth_headers(client, "qpd-b@example.com")

    r = await client.post("/businesses", headers=headers_a, json={"name": "A Co"})
    business_id = r.json()["id"]

    payload = {"tax_year": 2026, "quarter_label": "Q1", "usd_sales": 1000, "zig_sales": 0}
    r = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers_b, json=payload)
    assert r.status_code == 404


async def test_delete_business_cascades_calculations_and_assets(client):
    """Regression test: deleting a business with saved QPD calculations and
    capital assets must actually succeed (204), not 500. This is what was
    silently broken - the ORM cascade wasn't the problem in SQLite, but this
    test locks in the passive_deletes fix so it can never regress here."""
    headers = await _auth_headers(client, "delete-me@example.com")

    r = await client.post("/businesses", headers=headers, json={"name": "Doomed Co"})
    assert r.status_code == 201
    business_id = r.json()["id"]

    calc_payload = {
        "tax_year": 2026,
        "quarter_label": "Q1",
        "usd_sales": 1000,
        "zig_sales": 0,
        "usd_expenses": {"cost_of_sales": 0, "salaries": 0, "other_expenses": 0, "capital_allowances": 0},
        "zig_expenses": {"cost_of_sales": 0, "salaries": 0, "other_expenses": 0, "capital_allowances": 0},
    }
    r = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=calc_payload)
    assert r.status_code == 201, r.text

    asset_payload = {
        "description": "Delivery van",
        "category": "motor_vehicle",
        "cost_usd": 15000,
        "cost_zig": 0,
        "year_acquired": 2026,
        "elect_sia": False,
    }
    r = await client.post(f"/businesses/{business_id}/assets", headers=headers, json=asset_payload)
    assert r.status_code == 201, r.text

    r = await client.delete(f"/businesses/{business_id}", headers=headers)
    assert r.status_code == 204, r.text

    r = await client.get(f"/businesses/{business_id}", headers=headers)
    assert r.status_code == 404

    r = await client.get("/businesses", headers=headers)
    assert r.json() == []


async def test_delete_account_cascades_everything(client):
    """Regression test for the same class of bug on account deletion, which
    shares the identical cascade pattern one level up (User -> Business ->
    calculations/assets)."""
    headers = await _auth_headers(client, "delete-account@example.com")

    r = await client.post("/businesses", headers=headers, json={"name": "Also Doomed Co"})
    business_id = r.json()["id"]
    calc_payload = {"tax_year": 2026, "quarter_label": "Q1", "usd_sales": 500, "zig_sales": 0}
    r = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=calc_payload)
    assert r.status_code == 201, r.text

    r = await client.request(
        "DELETE", "/auth/me", headers=headers, json={"password": VALID_PASSWORD}
    )
    assert r.status_code == 204, r.text

    r = await client.get("/businesses", headers=headers)
    assert r.status_code == 401
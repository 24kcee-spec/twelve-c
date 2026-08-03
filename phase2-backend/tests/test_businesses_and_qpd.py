from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

VALID_PASSWORD = "Str0ngPassw0rd!"


async def _auth_headers(client, email="biz@example.com"):
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
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
    assert calc["result_json"]["schedule"][0]["usd"] == round(total_usd * 0.10, 2)

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

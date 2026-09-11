from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

from tests.test_businesses_and_qpd import _auth_headers


async def _make_business(client, headers, name="Monthly Income Co"):
    r = await client.post("/businesses", headers=headers, json={"name": name})
    return r.json()["id"]


async def test_upsert_and_get_round_trip(client):
    headers = await _auth_headers(client, "monthly-a@example.com")
    business_id = await _make_business(client, headers)

    r = await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers,
        json={
            "tax_year": 2026,
            "entries": [
                {"month": 1, "usd_amount": 5000, "zig_amount": 0, "is_estimate": False},
                {"month": 2, "usd_amount": 5500, "zig_amount": 0, "is_estimate": False},
                {"month": 3, "usd_amount": 6000, "zig_amount": 0, "is_estimate": True},
            ],
        },
    )
    assert r.status_code == 200
    saved = r.json()
    assert len(saved) == 3
    assert {e["month"] for e in saved} == {1, 2, 3}

    r = await client.get(f"/businesses/{business_id}/monthly-income/2026", headers=headers)
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 3
    by_month = {e["month"]: e for e in entries}
    assert by_month[1]["usd_amount"] == 5000
    assert by_month[3]["is_estimate"] is True


async def test_upsert_updates_existing_month_in_place(client):
    headers = await _auth_headers(client, "monthly-b@example.com")
    business_id = await _make_business(client, headers)

    await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers,
        json={"tax_year": 2026, "entries": [{"month": 1, "usd_amount": 1000, "zig_amount": 0, "is_estimate": True}]},
    )
    # Jan closes out - re-save it as an actual with the real figure. Should
    # update the same row, not create a second one.
    r = await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers,
        json={"tax_year": 2026, "entries": [{"month": 1, "usd_amount": 1234, "zig_amount": 0, "is_estimate": False}]},
    )
    assert r.status_code == 200

    r = await client.get(f"/businesses/{business_id}/monthly-income/2026", headers=headers)
    entries = r.json()
    assert len(entries) == 1
    assert entries[0]["usd_amount"] == 1234
    assert entries[0]["is_estimate"] is False


async def test_monthly_income_is_scoped_per_tax_year(client):
    headers = await _auth_headers(client, "monthly-c@example.com")
    business_id = await _make_business(client, headers)

    await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers,
        json={"tax_year": 2026, "entries": [{"month": 1, "usd_amount": 100, "zig_amount": 0}]},
    )
    await client.put(
        f"/businesses/{business_id}/monthly-income/2027",
        headers=headers,
        json={"tax_year": 2027, "entries": [{"month": 1, "usd_amount": 200, "zig_amount": 0}]},
    )

    r_2026 = await client.get(f"/businesses/{business_id}/monthly-income/2026", headers=headers)
    r_2027 = await client.get(f"/businesses/{business_id}/monthly-income/2027", headers=headers)
    assert r_2026.json()[0]["usd_amount"] == 100
    assert r_2027.json()[0]["usd_amount"] == 200


async def test_ownership_isolation(client):
    headers_a = await _auth_headers(client, "monthly-d@example.com")
    headers_b = await _auth_headers(client, "monthly-e@example.com")
    business_id = await _make_business(client, headers_a)

    await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers_a,
        json={"tax_year": 2026, "entries": [{"month": 1, "usd_amount": 100, "zig_amount": 0}]},
    )

    r = await client.get(f"/businesses/{business_id}/monthly-income/2026", headers=headers_b)
    assert r.status_code == 404

    r = await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers_b,
        json={"tax_year": 2026, "entries": [{"month": 1, "usd_amount": 999, "zig_amount": 0}]},
    )
    assert r.status_code == 404


async def test_rejects_invalid_month(client):
    headers = await _auth_headers(client, "monthly-f@example.com")
    business_id = await _make_business(client, headers)

    r = await client.put(
        f"/businesses/{business_id}/monthly-income/2026",
        headers=headers,
        json={"tax_year": 2026, "entries": [{"month": 13, "usd_amount": 100, "zig_amount": 0}]},
    )
    assert r.status_code == 422
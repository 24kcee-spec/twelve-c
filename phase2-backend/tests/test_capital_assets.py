from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

from tests.test_businesses_and_qpd import _auth_headers


async def _make_business(client, headers, name="Asset Co"):
    r = await client.post("/businesses", headers=headers, json={"name": name})
    return r.json()["id"]


async def test_asset_crud_and_ownership_isolation(client):
    headers_a = await _auth_headers(client, "assets-a@example.com")
    headers_b = await _auth_headers(client, "assets-b@example.com")
    business_id = await _make_business(client, headers_a)

    r = await client.post(
        f"/businesses/{business_id}/assets",
        headers=headers_a,
        json={
            "description": "Delivery van",
            "category": "motor_vehicle",
            "cost_usd": 20000,
            "cost_zig": 0,
            "year_acquired": 2025,
            "elect_sia": False,
        },
    )
    assert r.status_code == 201
    asset_id = r.json()["id"]

    # Owner B can't see or delete owner A's business's assets.
    r = await client.get(f"/businesses/{business_id}/assets", headers=headers_b)
    assert r.status_code == 404
    r = await client.delete(f"/businesses/{business_id}/assets/{asset_id}", headers=headers_b)
    assert r.status_code == 404

    r = await client.get(f"/businesses/{business_id}/assets", headers=headers_a)
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = await client.delete(f"/businesses/{business_id}/assets/{asset_id}", headers=headers_a)
    assert r.status_code == 204

    r = await client.get(f"/businesses/{business_id}/assets", headers=headers_a)
    assert r.json() == []


async def test_allowance_totals_wear_and_tear_vs_sia(client):
    headers = await _auth_headers(client, "assets-calc@example.com")
    business_id = await _make_business(client, headers)

    # Motor vehicle, wear & tear (20%/yr), acquired 2025 -> 2026 is year 1
    # since acquisition (index 1), still fully within the 5-year life.
    await client.post(
        f"/businesses/{business_id}/assets",
        headers=headers,
        json={
            "description": "Delivery van",
            "category": "motor_vehicle",
            "cost_usd": 20000,
            "cost_zig": 0,
            "year_acquired": 2025,
            "elect_sia": False,
        },
    )
    # Machinery, SIA elected (25%/yr for 4 years), acquired 2026.
    await client.post(
        f"/businesses/{business_id}/assets",
        headers=headers,
        json={
            "description": "Packaging line",
            "category": "machinery_other",
            "cost_usd": 0,
            "cost_zig": 100000,
            "year_acquired": 2026,
            "elect_sia": True,
        },
    )

    r = await client.get(f"/businesses/{business_id}/assets/allowance?tax_year=2026", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["tax_year"] == 2026
    # 20000 * 20% = 4000 (wear & tear, year 1 since acquisition)
    assert body["total_allowance_usd"] == pytest.approx(4000.0)
    # 100000 * 25% = 25000 (SIA, year of acquisition)
    assert body["total_allowance_zig"] == pytest.approx(25000.0)
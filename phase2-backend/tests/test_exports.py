from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

VALID_PASSWORD = "Str0ngPassw0rd!"

from tests.conftest import SENT_CODES


async def _auth_headers(client, email):
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    code = SENT_CODES[email]
    await client.post("/auth/verify-email", json={"email": email, "code": code})
    r = await client.post("/auth/login", json={"email": email, "password": VALID_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _calc_payload(quarter: int, usd_sales: float) -> dict:
    return {
        "tax_year": 2026,
        "quarter_label": f"Q{quarter}",
        "quarter": quarter,
        "usd_sales": usd_sales,
        "zig_sales": usd_sales * 26.8,
        "usd_expenses": {"cost_of_sales": 20_000, "salaries": 10_000, "other_expenses": 5_000, "capital_allowances": 0},
        "zig_expenses": {},
    }


async def test_excel_export_with_no_calculations_still_downloads(client):
    headers = await _auth_headers(client, "export-blank@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Blank Export Co"})
    business_id = r.json()["id"]

    r = await client.get(
        f"/businesses/{business_id}/export/excel", headers=headers, params={"tax_year": 2026}
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "Blank-Export-Co" in r.headers["content-disposition"]
    assert r.content.startswith(b"PK")  # xlsx is a zip container


async def test_pdf_export_with_no_calculations_still_downloads(client):
    headers = await _auth_headers(client, "export-blank-pdf@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Blank Export Co"})
    business_id = r.json()["id"]

    r = await client.get(
        f"/businesses/{business_id}/export/pdf", headers=headers, params={"tax_year": 2026}
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


async def test_excel_export_after_a_real_calculation(client):
    headers = await _auth_headers(client, "export-real@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Real Export Co"})
    business_id = r.json()["id"]

    r = await client.post(
        f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, 100_000)
    )
    assert r.status_code == 201, r.text

    r = await client.get(
        f"/businesses/{business_id}/export/excel", headers=headers, params={"tax_year": 2026}
    )
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"PK")

    r = await client.get(
        f"/businesses/{business_id}/export/pdf", headers=headers, params={"tax_year": 2026}
    )
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")


async def test_export_ownership_isolation(client):
    headers_a = await _auth_headers(client, "export-owner-a@example.com")
    headers_b = await _auth_headers(client, "export-owner-b@example.com")
    r = await client.post("/businesses", headers=headers_a, json={"name": "Owner A Export Co"})
    business_id = r.json()["id"]

    r = await client.get(
        f"/businesses/{business_id}/export/excel", headers=headers_b, params={"tax_year": 2026}
    )
    assert r.status_code == 404

    r = await client.get(
        f"/businesses/{business_id}/export/pdf", headers=headers_b, params={"tax_year": 2026}
    )
    assert r.status_code == 404


async def test_export_requires_auth(client):
    r = await client.get(
        "/businesses/00000000-0000-0000-0000-000000000000/export/excel",
        params={"tax_year": 2026},
    )
    assert r.status_code == 401

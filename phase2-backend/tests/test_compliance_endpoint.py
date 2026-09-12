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


def _calc_payload(quarter: int, usd_sales: float, zig_sales: float = 0) -> dict:
    return {
        "tax_year": 2026,
        "quarter_label": f"Q{quarter}",
        "quarter": quarter,
        "usd_sales": usd_sales,
        "zig_sales": zig_sales,
        "usd_expenses": {"cost_of_sales": 20_000, "salaries": 10_000, "other_expenses": 5_000, "capital_allowances": 0},
        "zig_expenses": {},
    }


async def test_no_calculations_yet_returns_has_data_false(client):
    headers = await _auth_headers(client, "no-data@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Blank Co"})
    business_id = r.json()["id"]

    r = await client.get(f"/businesses/{business_id}/compliance", headers=headers, params={"tax_year": 2026})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_data"] is False
    assert body["overall_status"] is None
    assert body["usd"] is None and body["zig"] is None
    assert body["quarters_missing"] == [1, 2, 3, 4]


async def test_ownership_isolation(client):
    headers_a = await _auth_headers(client, "compliance-owner-a@example.com")
    headers_b = await _auth_headers(client, "compliance-owner-b@example.com")
    r = await client.post("/businesses", headers=headers_a, json={"name": "Owner A Co"})
    business_id = r.json()["id"]

    r = await client.get(f"/businesses/{business_id}/compliance", headers=headers_b, params={"tax_year": 2026})
    assert r.status_code == 404


async def test_fully_compliant_business(client):
    """
    reference_tax is the FULL-YEAR estimated tax (see HANDOVER Step 3), not
    a quarter's cumulative-due slice - so only Q4 (100% cumulative, no
    prior quarters on record so previous_paid=0) has net_payable equal to
    the full total_tax. Confirming that amount in full is what should
    register as fully compliant.
    """
    headers = await _auth_headers(client, "compliant@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Compliant Co"})
    business_id = r.json()["id"]

    r = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(4, 100_000))
    calc = r.json()
    net_payable_usd = calc["result_json"]["net_payable_usd"]
    net_payable_zig = calc["result_json"]["net_payable_zig"]
    assert net_payable_usd == pytest.approx(calc["result_json"]["total_tax_usd"])

    # Confirm the FULL amount was actually remitted, BOTH legs - the engine
    # splits taxable profit across both currencies even for a 100%-USD-sales
    # business (see calculator.py's payment_ratio branch), so the ZiG leg
    # has a real, non-zero liability here too and must be settled for the
    # business to be genuinely fully compliant on both legs.
    await client.post(
        f"/businesses/{business_id}/qpd-calculations/{calc['id']}/confirm-payment",
        headers=headers,
        json={"actual_usd_paid": net_payable_usd, "actual_zig_paid": net_payable_zig},
    )

    r = await client.get(f"/businesses/{business_id}/compliance", headers=headers, params={"tax_year": 2026})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_data"] is True
    assert body["usd"]["status"] == "fully_compliant"
    assert body["overall_status"] in ("fully_compliant", "no_tax_due")


async def test_under_estimated_flagged_and_never_blended_across_currencies(client):
    """
    The engine splits taxable profit ~50/50 across USD/ZiG even for a
    100%-USD-sales business (see calculator.py's payment_ratio branch), so
    both legs carry a real, non-zero reference tax here. Confirm the USD
    leg IN FULL but leave the ZiG leg unpaid, to prove overall_status takes
    the WORSE leg rather than a blended/averaged figure - a healthy USD
    remittance must never paper over a genuinely under-remitted ZiG leg.
    """
    headers = await _auth_headers(client, "under-estimated@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Under Co"})
    business_id = r.json()["id"]

    # Q4 (100% cumulative, no prior quarters on record) so net_payable_usd
    # equals the full total_tax_usd - the reference_tax figure this check
    # is measured against.
    r = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(4, 100_000))
    calc = r.json()
    net_payable_usd = calc["result_json"]["net_payable_usd"]

    # USD paid in full; ZiG left at effectively nothing.
    await client.post(
        f"/businesses/{business_id}/qpd-calculations/{calc['id']}/confirm-payment",
        headers=headers,
        json={"actual_usd_paid": net_payable_usd, "actual_zig_paid": 0.01},
    )

    r = await client.get(f"/businesses/{business_id}/compliance", headers=headers, params={"tax_year": 2026})
    body = r.json()
    assert body["usd"]["status"] in ("fully_compliant", "within_buffer")
    assert body["zig"]["status"] == "under_estimated"
    assert body["overall_status"] == "under_estimated"
    assert body["zig"]["max_penalty_exposure"] > 0

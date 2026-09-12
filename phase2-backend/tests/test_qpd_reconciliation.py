from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.crud.qpd_calculation import get_tax_year_breakdown
from app.models.qpd_calculation import QpdCalculation

pytestmark = pytest.mark.asyncio

VALID_PASSWORD = "Str0ngPassw0rd!"

from tests.conftest import SENT_CODES


async def _auth_headers(client, email="reconciliation@example.com"):
    await client.post("/auth/register", json={"email": email, "password": VALID_PASSWORD})
    code = SENT_CODES[email]
    await client.post("/auth/verify-email", json={"email": email, "code": code})
    r = await client.post("/auth/login", json={"email": email, "password": VALID_PASSWORD})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _calc_payload(quarter: int, quarter_label: str, usd_sales: float = 100_000) -> dict:
    return {
        "tax_year": 2026,
        "quarter_label": quarter_label,
        "quarter": quarter,
        "usd_sales": usd_sales,
        "zig_sales": 0,
        "usd_expenses": {"cost_of_sales": 20_000, "salaries": 10_000, "other_expenses": 5_000, "capital_allowances": 0},
        "zig_expenses": {},
    }


async def test_missing_quarters_reported_and_excluded_from_total(client, db_session):
    headers = await _auth_headers(client)
    r = await client.post("/businesses", headers=headers, json={"name": "Partial Year Co"})
    business_id = uuid.UUID(r.json()["id"])

    # Only Q1 and Q2 have been calculated this tax year.
    r1 = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, "Q1"))
    assert r1.status_code == 201, r1.text
    r2 = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(2, "Q2"))
    assert r2.status_code == 201, r2.text

    breakdown = await get_tax_year_breakdown(db_session, business_id, 2026)

    assert breakdown.business_id == business_id
    assert breakdown.tax_year == 2026
    assert len(breakdown.quarters) == 4
    assert [q.quarter for q in breakdown.quarters] == [1, 2, 3, 4]

    q1, q2, q3, q4 = breakdown.quarters
    assert q1.has_calculation and q2.has_calculation
    assert not q3.has_calculation and not q4.has_calculation

    # Rows for missing quarters still carry the engine's due dates so the
    # table is fully displayable before every quarter has been run.
    assert q3.due_date == "25 September"
    assert q4.due_date == "20 December"
    assert q3.net_due_usd is None and q3.actual_usd_paid is None

    assert breakdown.quarters_missing == [3, 4]
    assert breakdown.latest_calculated_quarter == 2

    # Missing quarters contribute nothing to the remitted total - they are
    # not silently treated as zero-liability. (zig_sales=0 does not imply a
    # zero ZiG leg: the engine still splits USD-equivalent expenses across
    # both currencies via the payment ratio, so a non-zero ZiG figure here
    # is expected engine behaviour, not a test bug.)
    expected_total_usd = q1.actual_usd_paid + q2.actual_usd_paid
    expected_total_zig = q1.actual_zig_paid + q2.actual_zig_paid
    assert breakdown.total_remitted_usd == pytest.approx(expected_total_usd)
    assert breakdown.total_remitted_zig == pytest.approx(expected_total_zig)


async def test_confirmed_payment_overrides_seeded_default_in_breakdown(client, db_session):
    headers = await _auth_headers(client, "confirm@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Confirmed Co"})
    business_id = uuid.UUID(r.json()["id"])

    r1 = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, "Q1"))
    calc = r1.json()
    seeded_net_payable = calc["result_json"]["net_payable_usd"]
    calc_id = calc["id"]

    # Confirm a DIFFERENT amount than what was seeded (partial payment).
    confirmed_amount = round(seeded_net_payable * 0.5, 2)
    conf_r = await client.post(
        f"/businesses/{business_id}/qpd-calculations/{calc_id}/confirm-payment",
        headers=headers,
        json={"actual_usd_paid": confirmed_amount, "actual_zig_paid": 0},
    )
    assert conf_r.status_code == 200, conf_r.text

    breakdown = await get_tax_year_breakdown(db_session, business_id, 2026)
    q1 = breakdown.quarters[0]

    assert q1.actual_usd_paid == pytest.approx(confirmed_amount)
    assert q1.actual_usd_paid != pytest.approx(seeded_net_payable)
    assert breakdown.total_remitted_usd == pytest.approx(confirmed_amount)
    # The projected/required figures come from result_json and are
    # untouched by confirming a different actual payment.
    assert q1.net_due_usd == pytest.approx(seeded_net_payable)


async def test_recalculating_a_quarter_keeps_only_the_latest_run(client, db_session):
    headers = await _auth_headers(client, "recalc@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Revised Estimate Co"})
    business_id = uuid.UUID(r.json()["id"])

    first = await client.post(
        f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, "Q1", usd_sales=100_000)
    )
    assert first.status_code == 201
    # A later, revised estimate for the SAME quarter (business updated its
    # projection before the due date).
    second = await client.post(
        f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, "Q1", usd_sales=150_000)
    )
    assert second.status_code == 201
    second_id = second.json()["id"]

    # SQLite's server_default=func.now() only has second-level resolution,
    # so two records created back-to-back in a fast test can tie on
    # created_at (Postgres in production has microsecond precision, so this
    # is a test-environment artifact, not a real ordering bug). Force the
    # second record's timestamp forward deterministically so the
    # "latest run wins" behaviour under test is unambiguous.
    result = await db_session.execute(select(QpdCalculation).where(QpdCalculation.id == uuid.UUID(second_id)))
    second_record = result.scalar_one()
    second_record.created_at = datetime.now(timezone.utc) + timedelta(seconds=5)
    await db_session.commit()

    breakdown = await get_tax_year_breakdown(db_session, business_id, 2026)
    q1 = breakdown.quarters[0]

    assert str(q1.calculation_id) == second_id
    assert q1.total_projected_tax_usd == pytest.approx(second.json()["result_json"]["total_tax_usd"])


async def test_different_tax_year_is_isolated(client, db_session):
    headers = await _auth_headers(client, "multi-year@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Multi Year Co"})
    business_id = uuid.UUID(r.json()["id"])

    payload_2025 = _calc_payload(4, "Q4")
    payload_2025["tax_year"] = 2025
    await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=payload_2025)

    breakdown_2026 = await get_tax_year_breakdown(db_session, business_id, 2026)
    assert breakdown_2026.quarters_missing == [1, 2, 3, 4]
    assert breakdown_2026.latest_calculated_quarter is None
    assert breakdown_2026.total_remitted_usd == 0.0

    breakdown_2025 = await get_tax_year_breakdown(db_session, business_id, 2025)
    assert breakdown_2025.latest_calculated_quarter == 4

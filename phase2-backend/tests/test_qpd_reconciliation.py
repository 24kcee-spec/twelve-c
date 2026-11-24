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

    # Neither Q1 nor Q2 has been CONFIRMED yet (only calculated) - since
    # payment_confirmed_at exists now, total_remitted counts only confirmed
    # quarters, not the seeded net_payable assumption. Both should show up
    # as unconfirmed, and the total should be zero until they're confirmed.
    assert breakdown.quarters_unconfirmed == [1, 2]
    assert breakdown.total_remitted_usd == 0.0
    assert breakdown.total_remitted_zig == 0.0

    # Unconfirmed calculations must NOT assume they were paid.
    assert q1.actual_usd_paid is None and q1.actual_zig_paid is None
    assert q2.actual_usd_paid is None and q2.actual_zig_paid is None

    # Confirming both at their net-due figures is what moves them into
    # total_remitted - missing Q3/Q4 still contribute nothing.
    expected_total_usd = q1.net_due_usd + q2.net_due_usd
    expected_total_zig = q1.net_due_zig + q2.net_due_zig
    for q, calc_id in ((q1, r1.json()["id"]), (q2, r2.json()["id"])):
        conf = await client.post(
            f"/businesses/{business_id}/qpd-calculations/{calc_id}/confirm-payment",
            headers=headers,
            json={"actual_usd_paid": q.net_due_usd, "actual_zig_paid": q.net_due_zig},
        )
        assert conf.status_code == 200, conf.text

    breakdown = await get_tax_year_breakdown(db_session, business_id, 2026)
    assert breakdown.quarters_unconfirmed == []
    assert breakdown.total_remitted_usd == pytest.approx(expected_total_usd)
    assert breakdown.total_remitted_zig == pytest.approx(expected_total_zig)


async def test_confirmed_payment_records_actual_paid_in_breakdown(client, db_session):
    headers = await _auth_headers(client, "confirm@example.com")
    r = await client.post("/businesses", headers=headers, json={"name": "Confirmed Co"})
    business_id = uuid.UUID(r.json()["id"])

    r1 = await client.post(f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, "Q1"))
    calc = r1.json()
    assert calc["actual_usd_paid"] is None
    assert calc["actual_zig_paid"] is None
    assert calc["payment_confirmed_at"] is None
    net_payable = calc["result_json"]["net_payable_usd"]
    calc_id = calc["id"]

    # Confirm a partial payment.
    confirmed_amount = round(net_payable * 0.5, 2)
    conf_r = await client.post(
        f"/businesses/{business_id}/qpd-calculations/{calc_id}/confirm-payment",
        headers=headers,
        json={"actual_usd_paid": confirmed_amount, "actual_zig_paid": 0},
    )
    assert conf_r.status_code == 200, conf_r.text

    breakdown = await get_tax_year_breakdown(db_session, business_id, 2026)
    q1 = breakdown.quarters[0]

    assert q1.actual_usd_paid == pytest.approx(confirmed_amount)
    assert q1.actual_usd_paid != pytest.approx(net_payable)
    assert breakdown.total_remitted_usd == pytest.approx(confirmed_amount)
    # The projected/required figures come from result_json and are
    # untouched by confirming an actual payment.
    assert q1.net_due_usd == pytest.approx(net_payable)


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


async def test_confirmed_payment_propagates_into_next_quarters_calculation(client, db_session):
    """
    End-to-end regression test for the "Payments tab" bug: confirming what
    was actually paid for Q1 must change the `previous_paid_usd/zig` (and
    therefore `net_payable_usd/zig`) that the ENGINE computes when Q2 is
    calculated next - not just what get_tax_year_breakdown() displays after
    the fact. This exercises the real create_calculation ->
    _build_engine_input -> _sum_actual_paid_before_quarter chain via the
    actual HTTP API, the same path the frontend uses.
    """
    headers = await _auth_headers(client, "propagation@example.com")
    r = await client.post(f"/businesses", headers=headers, json={"name": "Propagation Co"})
    business_id = uuid.UUID(r.json()["id"])

    # Q1: actual_usd_paid is None until the user records a payment.
    q1 = await client.post(
        f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(1, "Q1", usd_sales=100_000)
    )
    assert q1.status_code == 201, q1.text
    assert q1.json()["actual_usd_paid"] is None
    assert q1.json()["payment_confirmed_at"] is None
    q1_net_payable_usd = q1.json()["result_json"]["net_payable_usd"]
    q1_id = q1.json()["id"]
    assert q1_net_payable_usd > 0

    # Before Q1 is confirmed as paid, Q2's calculation must NOT assume Q1
    # was paid - previous_paid_usd stays 0.
    q2_before_confirm = await client.post(
        f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(2, "Q2", usd_sales=100_000)
    )
    assert q2_before_confirm.status_code == 201, q2_before_confirm.text
    assert q2_before_confirm.json()["result_json"]["previous_paid_usd"] == 0.0

    # Now confirm that ONLY HALF of Q1 was actually remitted (a real
    # underpayment) - this is what the rebuilt Payments tab calls.
    confirmed_q1_usd = round(q1_net_payable_usd * 0.5, 2)
    conf_r = await client.post(
        f"/businesses/{business_id}/qpd-calculations/{q1_id}/confirm-payment",
        headers=headers,
        json={"actual_usd_paid": confirmed_q1_usd, "actual_zig_paid": 0},
    )
    assert conf_r.status_code == 200, conf_r.text

    # A fresh Q2 run (e.g. the person revises their Q2 estimate before the
    # due date - the same "latest run wins" workflow test_recalculating_a_
    # quarter_keeps_only_the_latest_run documents) must now net against the
    # CONFIRMED, partial figure - not silently fall back to the seeded
    # net_payable_usd from Q1, and not stay stuck at the earlier Q2 run's
    # now-stale previous_paid_usd.
    q2_after_confirm = await client.post(
        f"/businesses/{business_id}/qpd-calculations", headers=headers, json=_calc_payload(2, "Q2", usd_sales=100_000)
    )
    assert q2_after_confirm.status_code == 201, q2_after_confirm.text
    q2_result = q2_after_confirm.json()["result_json"]
    assert q2_result["previous_paid_usd"] == pytest.approx(confirmed_q1_usd)
    assert q2_result["previous_paid_usd"] != pytest.approx(q1_net_payable_usd)

    # And net_payable_usd must be correspondingly HIGHER than it would have
    # been against the full seeded amount, since less was actually paid.
    expected_net_payable = q2_result["cumulative_due_usd"] - confirmed_q1_usd
    assert q2_result["net_payable_usd"] == pytest.approx(max(0.0, expected_net_payable), abs=0.01)

    # The year breakdown view must agree with what the engine actually used.
    breakdown = await get_tax_year_breakdown(db_session, business_id, 2026)
    assert breakdown.quarters[0].actual_usd_paid == pytest.approx(confirmed_q1_usd)

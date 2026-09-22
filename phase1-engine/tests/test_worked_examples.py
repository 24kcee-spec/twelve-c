"""
Golden tests for the two worked-example companies.

Every figure below was ALSO produced by an independent implementation - the
live-formula workbook Twelve_C_QPD_Working_Papers.xlsx (see its 'Engine
Check' sheet) - and the two agree to the cent. So these numbers are pinned
by two different methods, not just by the engine agreeing with itself.

If you change engine maths ON PURPOSE, regenerate the workbook and update
these figures together.
"""

import copy

import pytest

from zimra_qpd.worked_examples import KHAMI, UMGUZA, run_company

# quarter, est_usd, est_zig, taxable_usd, taxable_zig, total_tax_usd, total_tax_zig,
# net_usd, net_zig, paid_usd, paid_zig
KHAMI_GOLDEN = [
    (1, 519540.0, 2625000.0, 26049.85, 698136.0, 6707.84, 179770.02, 670.78, 17977.0, 670.78, 17977.0),
    (2, 554190.0, 2919000.0, 40307.69, 1080246.0, 10379.23, 278163.34, 2061.95, 79380.17, 2061.95, 79380.17),
    (3, 551333.33, 2933333.33, 32777.36, 878433.29, 8440.17, 226196.57, 1853.38, 49670.6, 1853.38, 49670.6),
    (4, 576300.0, 3110000.0, 38754.48, 1038620.0, 9979.28, 267444.65, 3893.17, 120416.88, 3893.17, 120416.88),
]
UMGUZA_GOLDEN = [
    (1, 74000.0, 7240000.0, 7718.36, 405147.89, 1987.48, 104325.58, 198.75, 10432.56, 198.75, 10432.56),
    (2, 81200.0, 7730000.0, 10201.56, 621158.23, 2626.9, 159948.24, 720.67, 45549.33, 720.67, 36439.46),
    (3, 87066.67, 8040000.0, 9076.37, 488139.92, 2337.17, 125696.03, 599.74, 34830.4, 599.74, 34830.4),
    (4, 89700.0, 8660000.0, 11797.57, 788985.1, 3037.87, 203163.66, 1518.71, 121461.24, 1518.71, 121461.24),
]


def _check(company, golden):
    runs = run_company(company)
    assert [r.quarter for r in runs] == [1, 2, 3, 4]
    for run, g in zip(runs, golden):
        q, est_u, est_z, tp_u, tp_z, tt_u, tt_z, net_u, net_z, paid_u, paid_z = g
        res = run.result
        assert run.est_usd.estimate == pytest.approx(est_u, abs=0.005), f"Q{q} usd estimate"
        assert run.est_zig.estimate == pytest.approx(est_z, abs=0.005), f"Q{q} zig estimate"
        assert res.taxable_profit_usd == pytest.approx(tp_u, abs=0.005), f"Q{q} taxable usd"
        assert res.taxable_profit_zig == pytest.approx(tp_z, abs=0.005), f"Q{q} taxable zig"
        assert res.total_tax_usd == pytest.approx(tt_u, abs=0.005), f"Q{q} tax usd"
        assert res.total_tax_zig == pytest.approx(tt_z, abs=0.005), f"Q{q} tax zig"
        assert res.net_payable_usd == pytest.approx(net_u, abs=0.005), f"Q{q} net usd"
        assert res.net_payable_zig == pytest.approx(net_z, abs=0.005), f"Q{q} net zig"
        assert run.paid_usd == pytest.approx(paid_u, abs=0.005), f"Q{q} paid usd"
        assert run.paid_zig == pytest.approx(paid_z, abs=0.005), f"Q{q} paid zig"


def test_khami_golden_figures():
    _check(KHAMI, KHAMI_GOLDEN)


def test_umguza_golden_figures():
    _check(UMGUZA, UMGUZA_GOLDEN)


def test_usd_dominant_company_is_capped_at_50_50_every_quarter():
    for run in run_company(KHAMI):
        assert run.result.usd_ratio > run.result.zig_ratio
        assert run.result.payment_ratio_usd == 0.5
        assert run.result.payment_ratio_zig == 0.5


def test_zig_dominant_company_uses_the_real_ratio_uncapped():
    for run in run_company(UMGUZA):
        r = run.result
        assert r.zig_ratio > r.usd_ratio
        assert r.payment_ratio_usd == pytest.approx(r.usd_ratio)
        assert r.payment_ratio_zig == pytest.approx(r.zig_ratio)


def test_cumulative_percentages_and_final_quarter_settles_the_full_year():
    for co in (KHAMI, UMGUZA):
        runs = run_company(co)
        assert [r.result.cumulative_percentage for r in runs] == [0.10, 0.35, 0.65, 1.00]
        q4 = runs[3].result
        assert q4.cumulative_due_usd == pytest.approx(q4.total_tax_usd, abs=0.005)
        assert q4.cumulative_due_zig == pytest.approx(q4.total_tax_zig, abs=0.005)


def test_fully_paid_company_is_exactly_on_schedule_after_each_payment():
    # Khami pays in full every quarter: paid-to-date + withholding credits
    # always equals the cumulative amount due, in both currencies.
    paid_u = paid_z = 0.0
    for run in run_company(KHAMI):
        paid_u += run.paid_usd
        paid_z += run.paid_zig
        res = run.result
        wht_u = run.assumptions.withholding_credits_usd
        wht_z = run.assumptions.withholding_credits_zig
        assert paid_u + wht_u == pytest.approx(res.cumulative_due_usd, abs=0.011)
        assert paid_z + wht_z == pytest.approx(res.cumulative_due_zig, abs=0.011)


def test_previous_paid_is_what_was_really_paid_not_what_was_calculated():
    runs = run_company(UMGUZA)
    # QPD2's ZiG payment was only 80% of the net due...
    assert runs[1].paid_zig == pytest.approx(runs[1].result.net_payable_zig * 0.8, abs=0.005)
    # ...so QPD3 nets against the smaller real payment, not the calculated one.
    expected_prev = runs[0].paid_zig + runs[1].paid_zig
    assert runs[2].result.previous_paid_zig == pytest.approx(expected_prev, abs=0.005)
    assert runs[2].result.previous_paid_zig < runs[0].result.net_payable_zig + runs[1].result.net_payable_zig


def test_short_payment_is_caught_up_and_the_company_is_back_on_schedule_after_qpd3():
    runs = run_company(UMGUZA)
    q3 = runs[2]
    # After paying QPD3 in full the ZiG leg is level with the cumulative target.
    paid_z = sum(r.paid_zig for r in runs[:3])
    assert paid_z == pytest.approx(q3.result.cumulative_due_zig, abs=0.011)


def test_assessed_loss_lowers_zig_tax_only():
    with_loss = run_company(UMGUZA)[0].result
    no_loss_co = copy.deepcopy(UMGUZA)
    for qa in no_loss_co.quarters:
        qa.assessed_loss_zig = 0.0
    without_loss = run_company(no_loss_co)[0].result
    assert with_loss.total_tax_zig < without_loss.total_tax_zig
    assert with_loss.total_tax_usd == pytest.approx(without_loss.total_tax_usd)

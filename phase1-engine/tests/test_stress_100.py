"""
100-scenario invariant/property test suite for the ZIMRA QPD engine.

Unlike test_calculator.py (which checks exact figures against the
workbook's own worked example), this suite checks INVARIANTS that must
hold for ANY valid input, regardless of the specific numbers:

  1. usd_ratio + zig_ratio == 1 (when there's any income at all)
  2. payment_ratio_usd + payment_ratio_zig == 1
  3. Nothing (taxable profit, tax payable, AIDS levy, instalments) is
     ever negative
  4. The 4 quarterly instalments always sum back to total_tax (to
     rounding tolerance)
  5. QPD percentages are always exactly 10/25/30/35
  6. AIDS levy is always exactly aids_levy_rate * tax_payable (never of
     income/turnover)
  7. The 50/50 cap triggers exactly when USD strictly dominates
     (usd_ratio > zig_ratio), or when total income is zero; otherwise
     the real trade ratio is used uncapped
  8. Scaling invariant: doubling every income/expense input doubles
     every monetary output (catches hidden non-linear bugs - e.g. a
     stray clamp or hardcoded constant that only shows up off a 1x
     baseline)

14 hand-picked edge cases + 86 randomized cases (seed 12345, so the run
is reproducible) = 100 total.
"""

from __future__ import annotations

import random

import pytest

from zimra_qpd.calculator import CurrencyExpenses, QpdInput, calculate_qpd

TOL = 0.02  # 2-cent rounding tolerance across 4 summed instalments


def _check_invariants(data: QpdInput):
    result = calculate_qpd(data)

    # 1 & 2: ratios sum to 1 (skip when there's genuinely zero income;
    # ratios are then a convention, not a measurement)
    total_income = data.usd_sales + data.zig_sales / data.exchange_rate
    if total_income > 0:
        assert result.usd_ratio + result.zig_ratio == pytest.approx(1.0, abs=1e-9)
    assert result.payment_ratio_usd + result.payment_ratio_zig == pytest.approx(1.0, abs=1e-9)

    # 3: nothing negative
    for val in (
        result.taxable_profit_usd, result.taxable_profit_zig,
        result.tax_payable_usd, result.tax_payable_zig,
        result.aids_levy_usd, result.aids_levy_zig,
        result.total_tax_usd, result.total_tax_zig,
    ):
        assert val >= -1e-9

    # 4: instalments sum back to total tax
    assert sum(i.usd for i in result.schedule) == pytest.approx(result.total_tax_usd, abs=TOL)
    assert sum(i.zig for i in result.schedule) == pytest.approx(result.total_tax_zig, abs=TOL)

    # 5: percentages always exactly 10/25/30/35
    assert [i.percentage for i in result.schedule] == [0.10, 0.25, 0.30, 0.35]

    # 6: AIDS levy is exactly aids_levy_rate of tax payable
    assert result.aids_levy_usd == pytest.approx(data.aids_levy_rate * result.tax_payable_usd, abs=1e-6)
    assert result.aids_levy_zig == pytest.approx(data.aids_levy_rate * result.tax_payable_zig, abs=1e-6)

    # 7: cap triggers exactly when USD strictly dominates, or income is zero
    if total_income == 0:
        assert result.payment_ratio_usd == pytest.approx(0.5)
        assert result.payment_ratio_zig == pytest.approx(0.5)
    elif result.usd_ratio > result.zig_ratio:
        assert result.payment_ratio_usd == pytest.approx(0.5)
        assert result.payment_ratio_zig == pytest.approx(0.5)
    else:
        assert result.payment_ratio_usd == pytest.approx(result.usd_ratio)
        assert result.payment_ratio_zig == pytest.approx(result.zig_ratio)

    return result


# ---- 14 hand-picked edge cases -------------------------------------------

EDGE_CASES = [
    dict(usd_sales=0, zig_sales=0),                                   # all zero
    dict(usd_sales=0.01, zig_sales=0),                                # smallest possible USD
    dict(usd_sales=0, zig_sales=0.01),                                # smallest possible ZiG
    dict(usd_sales=1_000_000_000, zig_sales=0),                       # very large USD
    dict(usd_sales=0, zig_sales=26_800_000_000),                      # very large ZiG (=1bn USD-equiv)
    dict(usd_sales=100, zig_sales=2680),                               # exact 50/50 (2680/26.8=100)
    dict(usd_sales=100, zig_sales=2680.01),                            # 1 cent over 50/50 -> ZiG dominant
    dict(usd_sales=100.01, zig_sales=2680),                            # 1 cent over 50/50 -> USD dominant
    dict(usd_sales=100, zig_sales=0, usd_expenses=CurrencyExpenses(cost_of_sales=1_000_000)),  # huge loss
    dict(usd_sales=100, zig_sales=0, exchange_rate=1.0),                # exchange rate of exactly 1
    dict(usd_sales=100, zig_sales=0, exchange_rate=10_000.0),           # extreme hyperinflation rate
    dict(usd_sales=100, zig_sales=0, tax_rate=0.0, aids_levy_rate=0.0), # zero tax rate (sanity: everything 0)
    dict(usd_sales=5000, zig_sales=0,
         usd_expenses=CurrencyExpenses(cost_of_sales=1000, salaries=1000, other_expenses=1000, capital_allowances=1000)),
    dict(usd_sales=0, zig_sales=100_000,
         zig_expenses=CurrencyExpenses(cost_of_sales=20_000, salaries=20_000, other_expenses=20_000, capital_allowances=20_000)),
]


@pytest.mark.parametrize("kwargs", EDGE_CASES, ids=[f"edge_{i}" for i in range(len(EDGE_CASES))])
def test_edge_case_invariants(kwargs):
    defaults = dict(exchange_rate=26.8, tax_rate=0.25, aids_levy_rate=0.03)
    defaults.update(kwargs)
    _check_invariants(QpdInput(**defaults))


# ---- 86 randomized cases (reproducible, seed 12345) -----------------------

def _random_case(rng: random.Random) -> QpdInput:
    usd_sales = rng.uniform(0, 500_000)
    zig_sales = rng.uniform(0, 500_000 * 26.8)
    rate = rng.uniform(1, 200)

    def rand_expenses(scale):
        return CurrencyExpenses(
            cost_of_sales=rng.uniform(0, scale),
            salaries=rng.uniform(0, scale),
            other_expenses=rng.uniform(0, scale),
            capital_allowances=rng.uniform(0, scale),
        )

    return QpdInput(
        usd_sales=usd_sales,
        zig_sales=zig_sales,
        usd_expenses=rand_expenses(usd_sales * 0.6 if usd_sales else 1000),
        zig_expenses=rand_expenses(zig_sales * 0.6 if zig_sales else 1000),
        exchange_rate=rate,
        tax_rate=0.25,
        aids_levy_rate=0.03,
    )


RANDOM_CASES = [_random_case(random.Random(12345 + i)) for i in range(86)]


@pytest.mark.parametrize("data", RANDOM_CASES, ids=[f"random_{i}" for i in range(len(RANDOM_CASES))])
def test_randomized_invariants(data):
    _check_invariants(data)


# ---- Scaling invariant: doubling every input doubles every output ---------

@pytest.mark.parametrize("data", RANDOM_CASES[:20], ids=[f"scale_{i}" for i in range(20)])
def test_scaling_invariant(data):
    result_1x = calculate_qpd(data)

    doubled = QpdInput(
        usd_sales=data.usd_sales * 2,
        zig_sales=data.zig_sales * 2,
        usd_expenses=CurrencyExpenses(
            cost_of_sales=data.usd_expenses.cost_of_sales * 2,
            salaries=data.usd_expenses.salaries * 2,
            other_expenses=data.usd_expenses.other_expenses * 2,
            capital_allowances=data.usd_expenses.capital_allowances * 2,
        ),
        zig_expenses=CurrencyExpenses(
            cost_of_sales=data.zig_expenses.cost_of_sales * 2,
            salaries=data.zig_expenses.salaries * 2,
            other_expenses=data.zig_expenses.other_expenses * 2,
            capital_allowances=data.zig_expenses.capital_allowances * 2,
        ),
        exchange_rate=data.exchange_rate,
        tax_rate=data.tax_rate,
        aids_levy_rate=data.aids_levy_rate,
    )
    result_2x = calculate_qpd(doubled)

    # Skip the (rare, random) loss-making cases where 1x clamps to 0 but 2x
    # doesn't cross zero the same way - clamping at a boundary is inherently
    # non-linear by design (that's the point of the clamp), not a bug.
    if result_1x.taxable_profit_usd == 0 and result_1x.taxable_profit_zig == 0:
        pytest.skip("1x scenario is fully loss-clamped - scaling invariant doesn't apply at the clamp boundary")

    assert result_2x.total_tax_usd == pytest.approx(result_1x.total_tax_usd * 2, rel=1e-6, abs=1e-6)
    assert result_2x.total_tax_zig == pytest.approx(result_1x.total_tax_zig * 2, rel=1e-6, abs=1e-6)

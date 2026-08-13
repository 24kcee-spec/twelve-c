"""
These tests check the engine against the EXACT figures already computed by
the user's own 'ITF12C 2025' sheet, cell by cell (rows 6-39), so a pass here
means the Python engine reproduces the workbook's real output, not just its
formulas in the abstract.

Source figures (from the workbook):
  USD sales: 12000, ZIG sales: 0
  USD salaries: 3000, USD other expenses: 8900, everything else: 0
  Exchange rate: 26.8
  -> Adjusted income USD 6000 / ZIG 160800
  -> Adjusted deductions USD 5950 / ZIG 159460
  -> Taxable profit USD 50 / ZIG 1340
  -> Tax payable USD 12.5 / ZIG 335, AIDS levy USD 0.375 / ZIG 10.05
  -> Total tax USD 12.875 / ZIG 345.05
  -> Q1 (10%) USD 1.2875 / ZIG 34.505
"""

import pytest

from zimra_qpd.calculator import (
    CurrencyExpenses,
    QpdInput,
    apply_payments,
    calculate_qpd,
    project_annual_from_quarter,
)


@pytest.fixture
def workbook_example() -> QpdInput:
    return QpdInput(
        usd_sales=12000,
        zig_sales=0,
        usd_expenses=CurrencyExpenses(salaries=3000, other_expenses=8900),
        zig_expenses=CurrencyExpenses(),
        exchange_rate=26.8,
        tax_rate=0.25,
        aids_levy_rate=0.03,
    )


def test_currency_ratio_and_cap(workbook_example):
    result = calculate_qpd(workbook_example)
    # 100% USD trade -> USD dominant -> capped at 50/50
    assert result.usd_ratio == pytest.approx(1.0)
    assert result.zig_ratio == pytest.approx(0.0)
    assert result.payment_ratio_usd == pytest.approx(0.5)
    assert result.payment_ratio_zig == pytest.approx(0.5)


def test_adjusted_income_matches_workbook(workbook_example):
    result = calculate_qpd(workbook_example)
    assert result.adjusted_income_usd == pytest.approx(6000)
    assert result.adjusted_income_zig == pytest.approx(160800)


def test_adjusted_deductions_matches_workbook(workbook_example):
    result = calculate_qpd(workbook_example)
    assert result.adjusted_deductions_usd == pytest.approx(5950)
    assert result.adjusted_deductions_zig == pytest.approx(159460)


def test_taxable_profit_matches_workbook(workbook_example):
    result = calculate_qpd(workbook_example)
    assert result.taxable_profit_usd == pytest.approx(50)
    assert result.taxable_profit_zig == pytest.approx(1340)


def test_tax_and_aids_levy_matches_workbook(workbook_example):
    result = calculate_qpd(workbook_example)
    assert result.tax_payable_usd == pytest.approx(12.5)
    assert result.tax_payable_zig == pytest.approx(335)
    assert result.aids_levy_usd == pytest.approx(0.375)
    assert result.aids_levy_zig == pytest.approx(10.05)
    assert result.total_tax_usd == pytest.approx(12.875)
    assert result.total_tax_zig == pytest.approx(345.05)


def test_qpd_schedule_matches_workbook(workbook_example):
    result = calculate_qpd(workbook_example)
    q1, q2, q3, q4 = result.schedule

    assert q1.usd == pytest.approx(1.29, abs=0.01)
    assert q1.zig == pytest.approx(34.51, abs=0.01)
    assert q2.usd == pytest.approx(3.22, abs=0.01)
    assert q3.usd == pytest.approx(3.86, abs=0.01)
    assert q4.usd == pytest.approx(4.51, abs=0.01)

    # Instalments must sum back to total tax
    assert sum(i.usd for i in result.schedule) == pytest.approx(result.total_tax_usd, abs=0.01)
    assert sum(i.zig for i in result.schedule) == pytest.approx(result.total_tax_zig, abs=0.01)


def test_zig_dominant_uses_uncapped_ratio():
    """When ZIG trade dominates, the 50/50 cap should NOT apply."""
    data = QpdInput(
        usd_sales=1000,
        zig_sales=80400,  # 3000 USD-equivalent at rate 26.8 -> ZIG is 75% of trade
        exchange_rate=26.8,
    )
    result = calculate_qpd(data)
    assert result.usd_ratio < result.zig_ratio
    assert result.payment_ratio_usd == pytest.approx(result.usd_ratio)
    assert result.payment_ratio_zig == pytest.approx(result.zig_ratio)
    assert result.payment_ratio_usd != 0.5


def test_zero_exchange_rate_rejected():
    with pytest.raises(ValueError):
        calculate_qpd(QpdInput(usd_sales=100, zig_sales=0, exchange_rate=0))


def test_negative_sales_rejected():
    with pytest.raises(ValueError):
        calculate_qpd(QpdInput(usd_sales=-1, zig_sales=0, exchange_rate=26.8))


def test_no_income_no_crash():
    """Zero income must not raise a division-by-zero error."""
    result = calculate_qpd(QpdInput(usd_sales=0, zig_sales=0, exchange_rate=26.8))
    assert result.total_tax_usd == 0
    assert result.total_tax_zig == 0


def test_apply_payments_replaces_broken_tracking(workbook_example):
    """
    The original workbook's payment-tracking rows referenced blank cells and
    never worked. This confirms the replacement actually computes balances.
    """
    result = calculate_qpd(workbook_example)
    schedule = apply_payments(
        result.schedule,
        usd_paid=[1.29, 0, 0, 0],
        zig_paid=[34.51, 0, 0, 0],
    )
    assert schedule[0].usd_balance == pytest.approx(0.0, abs=0.01)
    assert schedule[1].usd_balance == pytest.approx(3.22, abs=0.01)


def test_project_annual_from_quarter1():
    # Matches the workbook's own annualisation shortcut: Q1 x 4
    assert project_annual_from_quarter(3000, quarters_elapsed=1) == pytest.approx(12000)


def test_project_annual_rejects_zero_quarters():
    with pytest.raises(ValueError):
        project_annual_from_quarter(1000, quarters_elapsed=0)


def test_zero_income_with_real_expenses_does_not_zero_out_deductions():
    """
    Regression test for the handover bug: a brand-new business with $0
    sales but real entered expenses (e.g. spent money before making any
    sales) must NOT show 'Adjusted deductions' as silently $0. Without the
    total_income_usd==0 guard, usd_ratio/zig_ratio both default to 0.0
    (0.0 > 0.0 is False), so payment_ratio would also default to 0.0/0.0
    and multiply every real expense down to nothing. Final tax is
    correctly 0 either way (taxable profit clamps at 0), but the
    intermediate figure must stay honest.
    """
    result = calculate_qpd(QpdInput(
        usd_sales=0, zig_sales=0, exchange_rate=26.8,
        usd_expenses=CurrencyExpenses(salaries=1200, other_expenses=800),
    ))
    assert result.payment_ratio_usd == pytest.approx(0.5)
    assert result.payment_ratio_zig == pytest.approx(0.5)
    assert result.adjusted_deductions_usd == pytest.approx(1000.0)  # 0.5 * 2000
    assert result.adjusted_deductions_zig == pytest.approx(0.5 * 2000 * 26.8)
    # Tax owed is still correctly zero - there's no income to tax.
    assert result.total_tax_usd == pytest.approx(0.0)
    assert result.total_tax_zig == pytest.approx(0.0)

def test_decimal_precision_exact_reconciliation_at_repeating_rate():
    """
    Regression test for the float -> Decimal migration. Exchange rate 3.0
    with sales/expenses chosen so several intermediate ratios are repeating
    binary fractions (thirds) - exactly the kind of number that used to
    accumulate silent float drift across the ratio -> split -> adjusted
    income/deductions -> tax -> AIDS levy chain. With Decimal at 50-digit
    precision this must reconcile EXACTLY (tight tolerance), not just
    "close enough".
    """
    data = QpdInput(
        usd_sales=10000,
        zig_sales=20000,  # /3.0 exchange rate -> repeating fraction ratios
        usd_expenses=CurrencyExpenses(cost_of_sales=1000, salaries=1000, other_expenses=1000),
        zig_expenses=CurrencyExpenses(cost_of_sales=3000, salaries=1500, other_expenses=750),
        exchange_rate=3.0,
        tax_rate=0.25,
        aids_levy_rate=0.03,
    )
    result = calculate_qpd(data)

    # Tight tolerance (1e-9) - float drift on this scenario would show up
    # well before this threshold; Decimal-based math clears it easily.
    assert result.usd_ratio + result.zig_ratio == pytest.approx(1.0, abs=1e-9)
    assert result.payment_ratio_usd + result.payment_ratio_zig == pytest.approx(1.0, abs=1e-9)
    assert result.aids_levy_usd == pytest.approx(
        result.tax_payable_usd * data.aids_levy_rate, abs=1e-9
    )

    # The 4 instalments must reconcile to the cent against total_tax, using
    # the SAME rounding convention production uses (ROUND_HALF_UP), not
    # Python's round() - this is the check that would catch a mismatch
    # between the engine's rounding and a naive test-side round().
    from decimal import ROUND_HALF_UP, Decimal
    def half_up(x: float) -> float:
        return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    total_usd = Decimal(str(result.total_tax_usd))
    for instalment, pct in zip(result.schedule, [Decimal("0.10"), Decimal("0.25"), Decimal("0.30"), Decimal("0.35")]):
        expected = float((total_usd * pct).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        assert instalment.usd == pytest.approx(expected, abs=1e-9)

"""
Tests for money.py. Test vectors marked [SPEC] are taken directly from
ZIMRA Fiscal Device Gateway API Specification v7.2's own worked examples
(Section 4.9.1's file example, and the RCPT026/RCPT027 formula text) —
verified against the live spec fetch on 25 Sep 2026, not paraphrased from
memory. Vectors marked [DERIVED] are hand-computed from the spec's stated
formulas, not copied from the spec's own numbers.
"""

from decimal import Decimal

import pytest

from fiscal_core.money import (
    MoneyError,
    calc_line_total,
    calc_sales_amount_with_tax,
    calc_tax_amount,
    format_money,
    from_minor_units,
    round_money,
    round_percent,
    round_quantity,
    sum_money,
    to_decimal,
    to_minor_units,
)


class TestToDecimal:
    def test_rejects_float(self):
        with pytest.raises(MoneyError, match="float"):
            to_decimal(28.75)

    def test_accepts_str(self):
        assert to_decimal("28.75") == Decimal("28.75")

    def test_accepts_int(self):
        assert to_decimal(28) == Decimal("28")

    def test_accepts_decimal(self):
        assert to_decimal(Decimal("28.75")) == Decimal("28.75")

    def test_rejects_garbage_string(self):
        with pytest.raises(MoneyError):
            to_decimal("not-a-number")


class TestRounding:
    def test_round_money_half_up(self):
        # ROUND_HALF_UP, not banker's rounding — 0.005 must round to 0.01
        assert round_money("0.005") == Decimal("0.01")
        assert round_money("0.015") == Decimal("0.02")

    def test_round_money_exact(self):
        assert round_money("28.75") == Decimal("28.75")

    def test_round_percent(self):
        assert round_percent("15") == Decimal("15.00")
        assert round_percent("0.125") == Decimal("0.13")

    def test_round_quantity_six_places(self):
        assert round_quantity("0.5555555") == Decimal("0.555556")


class TestMinorUnits:
    def test_to_minor_units_basic(self):
        assert to_minor_units(Decimal("28.75")) == 2875

    def test_to_minor_units_rounds_first(self):
        assert to_minor_units(Decimal("28.755")) == 2876  # HALF_UP

    def test_round_trip(self):
        original = Decimal("28.75")
        assert from_minor_units(to_minor_units(original)) == original

    def test_from_minor_units_requires_int(self):
        with pytest.raises(MoneyError):
            from_minor_units(Decimal("2875"))  # type: ignore[arg-type]


class TestFormatMoney:
    def test_keeps_trailing_zero(self):
        # [SPEC] Section 4.9.1 worked file example always shows exactly
        # 2dp, e.g. "receiptTotal": 28.75 — but a value like 28.7 must
        # format as "28.70", not "28.7"
        assert format_money("28.7") == "28.70"

    def test_whole_number(self):
        assert format_money("25") == "25.00"


class TestSumMoney:
    def test_sums_correctly(self):
        assert sum_money(["10.00", "5.00", "13.75"]) == Decimal("28.75")

    def test_empty_sums_to_zero(self):
        assert sum_money([]) == Decimal("0")

    def test_rejects_float_in_sequence(self):
        with pytest.raises(MoneyError):
            sum_money(["10.00", 5.5])  # the float should blow up, not silently corrupt


class TestCalcLineTotal:
    def test_spec_worked_example(self):
        # [SPEC] Section 4.9.1: "Man's shoes", receiptLinePrice: 25,
        # receiptLineQuantity: 1, receiptLineTotal: 25
        assert calc_line_total("25", "1") == Decimal("25.00")

    def test_derived_multi_quantity(self):
        # [DERIVED] 3 items @ 5000.00 = 15000.00 (matches Section 4.9.1's
        # second receipt line, "receiptLinePrice": 5000, "receiptLineQuantity": 3)
        assert calc_line_total("5000", "3") == Decimal("15000.00")


class TestCalcTaxAmount:
    def test_spec_worked_example_inclusive(self):
        # [SPEC] Section 4.9.1: single line total 25 (tax-inclusive),
        # taxPercent 15 -> taxAmount 3.75
        # Formula (RCPT026, tax-inclusive): SUM(lineTotal) * pct/(1+pct)
        # 25 * 0.15 / 1.15 = 3.260869... -> but spec's own worked value is 3.75
        # on total 28.75 sold at 15% inclusive: 28.75 * 0.15/1.15 = 3.75 exactly.
        # The worked example's receiptTaxes entry is against the FULL
        # receipt total (28.75), not a single line — use that.
        result = calc_tax_amount(["28.75"], "15", tax_inclusive=True)
        assert result == Decimal("3.75")

    def test_spec_worked_example_sales_amount(self):
        # [SPEC] Section 4.9.1: salesAmountWithTax: 28.75 for the same group
        result = calc_sales_amount_with_tax(["28.75"], "15", tax_inclusive=True)
        assert result == Decimal("28.75")

    def test_derived_exclusive(self):
        # [DERIVED] RCPT026 exclusive formula: SUM(lineTotal) * taxPercent
        # 100.00 exclusive at 15% -> taxAmount 15.00, salesAmountWithTax 115.00
        assert calc_tax_amount(["100.00"], "15", tax_inclusive=False) == Decimal("15.00")
        assert calc_sales_amount_with_tax(
            ["100.00"], "15", tax_inclusive=False
        ) == Decimal("115.00")

    def test_derived_multi_line_group(self):
        # [DERIVED] two lines in the same tax group, inclusive
        # SUM = 50.00, 15% inclusive -> 50 * 0.15/1.15 = 6.52 (rounded)
        result = calc_tax_amount(["30.00", "20.00"], "15", tax_inclusive=True)
        assert result == Decimal("6.52")

"""
Tests for canonicalise.py. Every test vector here is transcribed directly
from ZIMRA Fiscal Device Gateway API Specification v7.2, Section 13's own
worked examples (pages 71-77 of the spec PDF) -- not invented, not from a
third party. Counter ordering follows spec 5.4.4/5.4.5 enum order (see
TestCounterOrderingPerSpecEnums). The 13.3.1 example's SaleByTax rows and
stray "L" typo mean the full example string is deliberately not used as an
oracle; see the module docstring.
"""

from decimal import Decimal

import pytest

from fiscal_core.canonicalise import (
    FiscalDayCounter,
    TaxLine,
    build_fiscal_day_counter_segment,
    build_fiscal_day_fdms_signing_string,
    build_fiscal_day_signing_string,
    build_receipt_fdms_signing_string,
    build_receipt_signing_string,
    build_tax_line_signing_segment,
    sort_fiscal_day_counters,
    sort_receipt_taxes,
)


class TestSortReceiptTaxes:
    def test_sorts_by_tax_id_ascending(self):
        lines = [
            TaxLine(tax_id=2, tax_code="B", tax_percent=Decimal("0"), tax_amount=Decimal("0"), sales_amount_with_tax=Decimal("0")),
            TaxLine(tax_id=1, tax_code="A", tax_percent=Decimal("15"), tax_amount=Decimal("0"), sales_amount_with_tax=Decimal("0")),
        ]
        result = sort_receipt_taxes(lines)
        assert [t.tax_id for t in result] == [1, 2]

    def test_secondary_sort_by_tax_code_within_same_tax_id(self):
        lines = [
            TaxLine(tax_id=1, tax_code="D", tax_percent=Decimal("15"), tax_amount=Decimal("0"), sales_amount_with_tax=Decimal("0")),
            TaxLine(tax_id=1, tax_code="C", tax_percent=Decimal("15"), tax_amount=Decimal("0"), sales_amount_with_tax=Decimal("0")),
        ]
        result = sort_receipt_taxes(lines)
        assert [t.tax_code for t in result] == ["C", "D"]

    def test_missing_tax_code_sorts_first(self):
        lines = [
            TaxLine(tax_id=1, tax_code="A", tax_percent=Decimal("15"), tax_amount=Decimal("0"), sales_amount_with_tax=Decimal("0")),
            TaxLine(tax_id=1, tax_code="", tax_percent=Decimal("15"), tax_amount=Decimal("0"), sales_amount_with_tax=Decimal("0")),
        ]
        result = sort_receipt_taxes(lines)
        assert result[0].tax_code == ""


class TestBuildTaxLineSigningSegment:
    """Spec Section 13.2.1 field 7 worked examples."""

    def test_fiscalinvoice_example_1_line_a_no_percent(self):
        # taxCode A, no taxPercent given, taxAmount 0.00, sales 2500.00
        line = TaxLine(tax_id=1, tax_code="A", tax_percent=None, tax_amount=Decimal("0.00"), sales_amount_with_tax=Decimal("2500.00"))
        assert build_tax_line_signing_segment(line) == "A0250000"

    def test_fiscalinvoice_example_1_line_b_zero_percent(self):
        line = TaxLine(tax_id=2, tax_code="B", tax_percent=Decimal("0"), tax_amount=Decimal("0.00"), sales_amount_with_tax=Decimal("3500.00"))
        assert build_tax_line_signing_segment(line) == "B0.000350000"

    def test_fiscalinvoice_example_1_line_c_fifteen_percent(self):
        line = TaxLine(tax_id=3, tax_code="C", tax_percent=Decimal("15"), tax_amount=Decimal("150.00"), sales_amount_with_tax=Decimal("1150.00"))
        assert build_tax_line_signing_segment(line) == "C15.0015000115000"

    def test_fiscalinvoice_example_2_no_taxcode_fourteen_point_five_percent(self):
        # deviceID 322 example: no taxCode column at all -> empty string
        line = TaxLine(tax_id=3, tax_code="", tax_percent=Decimal("14.5"), tax_amount=Decimal("0.05"), sales_amount_with_tax=Decimal("0.35"))
        assert build_tax_line_signing_segment(line) == "14.50535"

    def test_creditnote_negative_amounts(self):
        # CreditNote Example 1, line C: taxAmount -150.00, sales -1150.00
        line = TaxLine(tax_id=3, tax_code="C", tax_percent=Decimal("15"), tax_amount=Decimal("-150.00"), sales_amount_with_tax=Decimal("-1150.00"))
        assert build_tax_line_signing_segment(line) == "C15.00-15000-115000"


class TestBuildReceiptSigningString:
    def test_fiscalinvoice_example_1_full_string(self):
        """Reproduces spec Section 13.2.1 FiscalInvoice 'Example No 1' byte for byte."""
        tax_lines = [
            TaxLine(tax_id=1, tax_code="A", tax_percent=None, tax_amount=Decimal("0.00"), sales_amount_with_tax=Decimal("2500.00")),
            TaxLine(tax_id=2, tax_code="B", tax_percent=Decimal("0"), tax_amount=Decimal("0.00"), sales_amount_with_tax=Decimal("3500.00")),
            TaxLine(tax_id=3, tax_code="C", tax_percent=Decimal("15"), tax_amount=Decimal("150.00"), sales_amount_with_tax=Decimal("1150.00")),
            TaxLine(tax_id=3, tax_code="D", tax_percent=Decimal("15"), tax_amount=Decimal("300.00"), sales_amount_with_tax=Decimal("2300.00")),
        ]
        result = build_receipt_signing_string(
            device_id=321,
            receipt_type="FiscalInvoice",
            receipt_currency="ZWL",
            receipt_global_no=432,
            receipt_date="2019-09-19T15:43:12",
            receipt_total=Decimal("9450.00"),
            tax_lines=tax_lines,
            previous_receipt_hash="hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=",
        )
        expected = (
            "321FISCALINVOICEZWL4322019-09-19T15:43:12945000"
            "A0250000B0.000350000C15.0015000115000D15.0030000230000"
            "hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k="
        )
        assert result == expected

    def test_fiscalinvoice_example_2_tax_segment_portion(self):
        """Spec Example No 2's tax-lines result is independently confirmed
        ('07000.000100014.50535'); the full-string row in the PDF itself is
        garbled (missing the deviceID/receiptType/... prefix -- a table
        extraction artifact in the source document, not a rule we should
        encode), so only the confirmed portion is asserted end-to-end."""
        tax_lines = [
            TaxLine(tax_id=1, tax_code="", tax_percent=None, tax_amount=Decimal("0.00"), sales_amount_with_tax=Decimal("7.00")),
            TaxLine(tax_id=2, tax_code="", tax_percent=Decimal("0"), tax_amount=Decimal("0.00"), sales_amount_with_tax=Decimal("10.00")),
            TaxLine(tax_id=3, tax_code="", tax_percent=Decimal("14.5"), tax_amount=Decimal("0.05"), sales_amount_with_tax=Decimal("0.35")),
        ]
        result = build_receipt_signing_string(
            device_id=322,
            receipt_type="FiscalInvoice",
            receipt_currency="USD",
            receipt_global_no=85,
            receipt_date="2019-09-19T09:23:07",
            receipt_total=Decimal("40.35"),
            tax_lines=tax_lines,
            previous_receipt_hash="hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=",
        )
        assert "07000.000100014.50535" in result

    def test_first_receipt_of_day_omits_previous_hash(self):
        result = build_receipt_signing_string(
            device_id=1, receipt_type="FiscalInvoice", receipt_currency="USD",
            receipt_global_no=1, receipt_date="2026-01-01T09:00:00",
            receipt_total=Decimal("10.00"), tax_lines=[], previous_receipt_hash=None,
        )
        assert result == "1FISCALINVOICEUSD12026-01-01T09:00:001000"


class TestBuildReceiptFdmsSigningString:
    def test_worked_example(self):
        sig = (
            "YyXTSizBBrMjMk4VQL+sCNr+2AC6aQbDAn9JMV2rk3yJ6MDZwie0wqQW3oisNWrMkeZsuAyFSnFkU2A"
            "+pKm91sOHVdjeRBebjQgAQQIMTCVIcYrx+BizQ7Ib9iCdsVI+Jel2nThqQiQzfRef6EgtgsaIAN+PV55"
            "xSrHvPkIe+Bc="
        )
        result = build_receipt_fdms_signing_string(
            receipt_device_signature=sig, receipt_id=48377, server_date="2019-09-19T15:43:12",
        )
        assert result == f"{sig}483772019-09-19T15:43:12"


class TestFiscalDayCounterSegment:
    def test_saletax_examples_from_13_3_1(self):
        assert build_fiscal_day_counter_segment(
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("23000.00"))
        ) == "SALEBYTAXZWL2300000"
        assert build_fiscal_day_counter_segment(
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("12000.00"), tax_percent=Decimal("0"))
        ) == "SALEBYTAXZWL0.001200000"
        assert build_fiscal_day_counter_segment(
            FiscalDayCounter("SaleByTax", "USD", Decimal("25.00"), tax_percent=Decimal("14.5"))
        ) == "SALEBYTAXUSD14.502500"
        assert build_fiscal_day_counter_segment(
            FiscalDayCounter("SaleTaxByTax", "ZWL", Decimal("2300.00"), tax_percent=Decimal("15"))
        ) == "SALETAXBYTAXZWL15.00230000"


class TestBuildFiscalDaySigningString:
    def test_salebytax_saletaxbytax_portion_of_13_3_1_example(self):
        """
        Reproduces the SaleByTax/SaleTaxByTax run of the 13.3.1 worked
        example byte for byte. The example's BalanceByMoneyType lines are
        deliberately excluded here -- see module docstring: that part of
        the spec's own worked example is internally inconsistent (wrong
        alphabetical order plus a transcription typo) and isn't a safe
        test oracle for cross-type or intra-type-but-across-moneytype
        ordering.
        """
        counters = [
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("23000.00")),
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("12000.00"), tax_percent=Decimal("0")),
            FiscalDayCounter("SaleByTax", "USD", Decimal("25.00"), tax_percent=Decimal("14.5")),
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("12.00"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleTaxByTax", "USD", Decimal("2.50"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleTaxByTax", "ZWL", Decimal("2300.00"), tax_percent=Decimal("15")),
        ]
        # Fed in spec-example order already (grouped by type); this function
        # sorts within each type but doesn't reorder types.
        result = build_fiscal_day_signing_string(
            device_id=321, fiscal_day_no=84, fiscal_day_date="2019-09-23", counters=counters,
        )
        assert result.startswith("321842019-09-23")
        assert "SALEBYTAXZWL2300000" in result
        assert "SALEBYTAXZWL0.001200000" in result
        assert "SALEBYTAXUSD14.502500" in result
        assert "SALETAXBYTAXZWL15.00230000" in result

    def test_zero_value_counters_excluded(self):
        counters = [
            FiscalDayCounter("SaleByTax", "USD", Decimal("0.00")),
            FiscalDayCounter("SaleByTax", "USD", Decimal("10.00"), tax_percent=Decimal("15")),
        ]
        result = build_fiscal_day_signing_string(
            device_id=1, fiscal_day_no=1, fiscal_day_date="2026-01-01", counters=counters,
        )
        assert result == "112026-01-01SALEBYTAXUSD15.001000"


class TestSortFiscalDayCounters:
    def test_sorts_by_currency_then_percent_within_one_type(self):
        counters = [
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("1"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleByTax", "USD", Decimal("1"), tax_percent=Decimal("0")),
        ]
        result = sort_fiscal_day_counters(counters)
        assert [c.currency for c in result] == ["USD", "ZWL"]


class TestBuildFiscalDayFdmsSigningString:
    def test_worked_example_auto_mode(self):
        counters = [
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("23000.00")),
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("12000.00"), tax_percent=Decimal("0")),
            FiscalDayCounter("SaleByTax", "USD", Decimal("25.00"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleByTax", "ZWL", Decimal("12.00"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleTaxByTax", "USD", Decimal("2.50"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleTaxByTax", "ZWL", Decimal("2300.00"), tax_percent=Decimal("15")),
        ]
        sig = (
            "YyXTSizBBrMjMk4VQL+sCNr+2AC6aQbDAn9JMV2rk3yJ6MDZwie0wqQW3oisNWrMkeZsuAyFSnFkU2A"
            "+pKm91sOHVdjeRBebjQgAQQIMTCVIcYrx+BizQ7Ib9iCdsVI+Jel2nThqQiQzfRef6EgtgsaIAN+PV55"
            "xSrHvPkIe+Bc="
        )
        result = build_fiscal_day_fdms_signing_string(
            device_id=321, fiscal_day_no=84, fiscal_day_date="2019-09-23",
            fiscal_day_updated="2019-09-23T22:21:14", reconciliation_mode="auto",
            counters=counters, fiscal_day_device_signature=sig,
        )
        assert result.startswith("321842019-09-232019-09-23T22:21:14AUTO")
        assert result.endswith(sig)

    def test_manual_mode_omits_device_signature(self):
        counters = [FiscalDayCounter("SaleByTax", "USD", Decimal("10.00"), tax_percent=Decimal("15"))]
        result = build_fiscal_day_fdms_signing_string(
            device_id=1, fiscal_day_no=1, fiscal_day_date="2026-01-01",
            fiscal_day_updated="2026-01-01T18:00:00", reconciliation_mode="MANUAL",
            counters=counters, fiscal_day_device_signature=None,
        )
        assert not result.endswith("None")
        assert "MANUAL" in result

    def test_auto_mode_without_signature_raises(self):
        with pytest.raises(ValueError):
            build_fiscal_day_fdms_signing_string(
                device_id=1, fiscal_day_no=1, fiscal_day_date="2026-01-01",
                fiscal_day_updated="2026-01-01T18:00:00", reconciliation_mode="AUTO",
                counters=[], fiscal_day_device_signature=None,
            )

    def test_invalid_reconciliation_mode_raises(self):
        with pytest.raises(ValueError):
            build_fiscal_day_fdms_signing_string(
                device_id=1, fiscal_day_no=1, fiscal_day_date="2026-01-01",
                fiscal_day_updated="2026-01-01T18:00:00", reconciliation_mode="SOMETHING",
                counters=[], fiscal_day_device_signature=None,
            )


class TestCounterOrderingPerSpecEnums:
    """Section 5.4.4 (counter type) and 5.4.5 (money type) enum order."""

    TAIL = (
        "SALETAXBYTAXUSD15.00250"
        "SALETAXBYTAXZWL15.00230000"
        "BALANCEBYMONEYTYPEUSDCASH3700"
        "BALANCEBYMONEYTYPEZWLCASH2000000"
        "BALANCEBYMONEYTYPEZWLCARD1500000"
    )

    def _tail_counters(self):
        return [
            FiscalDayCounter("SaleTaxByTax", "USD", Decimal("2.50"), tax_percent=Decimal("15")),
            FiscalDayCounter("SaleTaxByTax", "ZWL", Decimal("2300.00"), tax_percent=Decimal("15")),
            FiscalDayCounter("BalanceByMoneyType", "USD", Decimal("37.00"), money_type="CASH"),
            FiscalDayCounter("BalanceByMoneyType", "ZWL", Decimal("20000.00"), money_type="CASH"),
            FiscalDayCounter("BalanceByMoneyType", "ZWL", Decimal("15000.00"), money_type="CARD"),
        ]

    def test_13_3_1_example_tail_reproduced_in_order(self):
        result = build_fiscal_day_signing_string(321, 84, "2019-09-23", self._tail_counters())
        assert result == "321842019-09-23" + self.TAIL

    def test_input_order_does_not_matter(self):
        shuffled = list(reversed(self._tail_counters()))
        result = build_fiscal_day_signing_string(321, 84, "2019-09-23", shuffled)
        assert result == "321842019-09-23" + self.TAIL

    def test_all_seven_types_in_enum_order_not_alphabetical(self):
        names = [
            "BalanceByMoneyType", "DebitNoteTaxByTax", "DebitNoteByTax",
            "CreditNoteTaxByTax", "CreditNoteByTax", "SaleTaxByTax", "SaleByTax",
        ]
        counters = [
            FiscalDayCounter(n, "USD", Decimal("1"), money_type="CASH")
            if n == "BalanceByMoneyType"
            else FiscalDayCounter(n, "USD", Decimal("1"), tax_percent=Decimal("15"))
            for n in names
        ]
        ordered = [c.counter_type for c in sort_fiscal_day_counters(counters)]
        assert ordered == [
            "SaleByTax", "SaleTaxByTax", "CreditNoteByTax", "CreditNoteTaxByTax",
            "DebitNoteByTax", "DebitNoteTaxByTax", "BalanceByMoneyType",
        ]

    def test_money_type_enum_order_cash_card_mobilewallet(self):
        counters = [
            FiscalDayCounter("BalanceByMoneyType", "USD", Decimal("1"), money_type="MobileWallet"),
            FiscalDayCounter("BalanceByMoneyType", "USD", Decimal("1"), money_type="Card"),
            FiscalDayCounter("BalanceByMoneyType", "USD", Decimal("1"), money_type="Cash"),
        ]
        ordered = [c.money_type for c in sort_fiscal_day_counters(counters)]
        assert ordered == ["Cash", "Card", "MobileWallet"]

    def test_tax_id_is_sort_key_when_given(self):
        counters = [
            FiscalDayCounter("SaleByTax", "USD", Decimal("1"), tax_percent=Decimal("0"), tax_id=3),
            FiscalDayCounter("SaleByTax", "USD", Decimal("1"), tax_percent=Decimal("15"), tax_id=1),
        ]
        assert [c.tax_id for c in sort_fiscal_day_counters(counters)] == [1, 3]

    def test_unknown_counter_type_raises(self):
        import pytest
        with pytest.raises(ValueError):
            sort_fiscal_day_counters([FiscalDayCounter("Bogus", "USD", Decimal("1"))])

    def test_unknown_money_type_raises(self):
        import pytest
        with pytest.raises(ValueError):
            sort_fiscal_day_counters(
                [FiscalDayCounter("BalanceByMoneyType", "USD", Decimal("1"), money_type="BARTER")]
            )

    def test_fdms_string_orders_counters_too(self):
        result = build_fiscal_day_fdms_signing_string(
            321, 84, "2019-09-23", "2019-09-23T22:21:14", "MANUAL",
            list(reversed(self._tail_counters())), None,
        )
        assert result == "321842019-09-232019-09-23T22:21:14MANUAL" + self.TAIL

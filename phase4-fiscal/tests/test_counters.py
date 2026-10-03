"""Tests for counters.py (Phase 4 / P6): spec section 6 counter rules, rebuild, diff."""

from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from fiscal_core.canonicalise import build_fiscal_day_signing_string, sort_fiscal_day_counters
from fiscal_core.counters import (
    CounterDiff, CounterError, CounterKey, CounterType as C, FiscalDayCounters, MoneyType as M,
    counters_for_day, diff_counters, rebuild_day)
from fiscal_core.fdms_client import FdmsClient
from fiscal_core.state import DayEvent as E, ReceiptState as R
from fiscal_core.store import FiscalStore

D = Decimal


def tax(tid, pct, sales, tax_amt):
    t = {"taxID": tid, "salesAmountWithTax": D(sales), "taxAmount": D(tax_amt)}
    if pct is not None:
        t["taxPercent"] = D(pct)
    return t


def receipt(rtype="FiscalInvoice", cur="USD", taxes=(), pays=(), total=None):
    r = {"receiptType": rtype, "receiptCurrency": cur, "receiptTaxes": list(taxes),
         "receiptPayments": [{"moneyTypeCode": m, "paymentAmount": D(a)} for m, a in pays]}
    if total is not None:
        r["receiptTotal"] = D(total)
    return r


def val(c, ctype, cur, tid=None, pct=None, mt=None):
    return c.value(CounterKey(ctype, cur, tid, None if pct is None else D(pct), mt))


# ------------------------------------------------------------ section 6 table
class TestSection6Table:
    def test_fiscal_invoice_updates_sale_tax_and_balance(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(taxes=[tax(3, "15.5", "115.00", "15.44")], pays=[("Cash", "115.00")], total="115.00"))
        assert val(c, C.SaleByTax, "USD", 3, "15.5") == D("115.00")
        assert val(c, C.SaleTaxByTax, "USD", 3, "15.5") == D("15.44")
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.Cash) == D("115.00")
        assert [k.counter_type for k, _ in c.nonzero()] == [C.SaleByTax, C.SaleTaxByTax, C.BalanceByMoneyType]

    def test_credit_note_uses_credit_counters_and_negative_amounts(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt("CreditNote", taxes=[tax(3, "15.5", "-23.00", "-3.09")], pays=[("Cash", "-23.00")], total="-23.00"))
        assert val(c, C.CreditNoteByTax, "USD", 3, "15.5") == D("-23.00")
        assert val(c, C.CreditNoteTaxByTax, "USD", 3, "15.5") == D("-3.09")
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.Cash) == D("-23.00")
        assert val(c, C.SaleByTax, "USD", 3, "15.5") == 0

    def test_debit_note_uses_debit_counters_positive(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt("DebitNote", taxes=[tax(3, "15.5", "10.00", "1.34")], pays=[("Card", "10.00")], total="10.00"))
        assert val(c, C.DebitNoteByTax, "USD", 3, "15.5") == D("10.00")
        assert val(c, C.DebitNoteTaxByTax, "USD", 3, "15.5") == D("1.34")
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.Card) == D("10.00")

    def test_credit_note_after_sale_reduces_balance_but_keeps_sale_counter(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(taxes=[tax(3, "15.5", "115.00", "15.44")], pays=[("Cash", "115.00")]))
        c.apply_receipt(receipt("CreditNote", taxes=[tax(3, "15.5", "-23.00", "-3.09")], pays=[("Cash", "-23.00")]))
        assert val(c, C.SaleByTax, "USD", 3, "15.5") == D("115.00")           # credit notes never touch SaleByTax
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.Cash) == D("92.00")

    def test_multiple_tax_groups_and_payment_methods(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(
            taxes=[tax(1, None, "10.00", "0.00"), tax(2, "0", "20.00", "0.00"), tax(3, "15.5", "30.00", "4.03")],
            pays=[("Cash", "40.00"), ("MobileWallet", "20.00")], total="60.00"))
        assert val(c, C.SaleByTax, "USD", 1, None) == D("10.00")              # exempt: no percent
        assert val(c, C.SaleByTax, "USD", 2, "0") == D("20.00")
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.MobileWallet) == D("20.00")

    def test_counters_accumulate_across_receipts(self):
        c = FiscalDayCounters()
        for _ in range(3):
            c.apply_receipt(receipt(taxes=[tax(3, "15.5", "10.10", "1.36")], pays=[("Cash", "10.10")]))
        assert val(c, C.SaleByTax, "USD", 3, "15.5") == D("30.30")
        assert str(val(c, C.SaleTaxByTax, "USD", 3, "15.5")) == "4.08"

    def test_same_tax_percent_written_differently_is_one_counter(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "10.00")]))
        c.apply_receipt(receipt(taxes=[tax(3, "15.00", "10.00", "1.30")], pays=[("Cash", "10.00")]))
        assert val(c, C.SaleByTax, "USD", 3, "15") == D("20.00")
        assert len([k for k, _ in c.items() if k.counter_type is C.SaleByTax]) == 1

    @pytest.mark.parametrize("name,expected", [(m.name, m) for m in M])
    def test_every_money_type_is_counted(self, name, expected):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(pays=[(name, "5.00")]))
        assert val(c, C.BalanceByMoneyType, "USD", mt=expected) == D("5.00")

    def test_numeric_enum_values_accepted(self):
        c = FiscalDayCounters()
        c.apply_receipt({"receiptType": 1, "receiptCurrency": "usd", "receiptTaxes": [],
                         "receiptPayments": [{"moneyTypeCode": 5, "paymentAmount": D("-1.00")}]})
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.BankTransfer) == D("-1.00")


class TestCurrencies:
    def test_usd_and_zig_are_never_netted(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(cur="USD", taxes=[tax(3, "15.5", "100.00", "13.42")], pays=[("Cash", "100.00")]))
        c.apply_receipt(receipt(cur="ZWG", taxes=[tax(3, "15.5", "2700.00", "362.34")], pays=[("Cash", "2700.00")]))
        assert val(c, C.SaleByTax, "USD", 3, "15.5") == D("100.00")
        assert val(c, C.SaleByTax, "ZWG", 3, "15.5") == D("2700.00")
        wire = c.to_wire()
        assert {r["fiscalCounterCurrency"] for r in wire} == {"USD", "ZWG"}
        assert not any(r["fiscalCounterValue"] == D("2800.00") for r in wire)


# ------------------------------------------------------------------ rejection
class TestValidation:
    def bad(self, r, match):
        c = FiscalDayCounters()
        with pytest.raises(CounterError, match=match):
            c.apply_receipt(r)
        assert c.nonzero() == []                                              # nothing was counted

    def test_float_amount_refused(self):
        r = receipt(pays=[("Cash", "1.00")])
        r["receiptPayments"][0]["paymentAmount"] = 1.0
        self.bad(r, "Decimal or int")

    def test_sub_cent_amount_refused(self):
        r = receipt(pays=[("Cash", "1.00")])
        r["receiptPayments"][0]["paymentAmount"] = D("1.005")
        self.bad(r, "cents")

    def test_bool_amount_refused(self):
        r = receipt(pays=[("Cash", "1.00")])
        r["receiptPayments"][0]["paymentAmount"] = True
        self.bad(r, "Decimal or int")

    def test_credit_note_with_positive_payment_refused_rcpt028(self):
        self.bad(receipt("CreditNote", pays=[("Cash", "5.00")]), "RCPT028")

    def test_invoice_with_negative_payment_refused_rcpt028(self):
        self.bad(receipt("FiscalInvoice", pays=[("Cash", "-5.00")]), "RCPT028")

    def test_total_must_equal_tax_sales_sum_rcpt038(self):
        self.bad(receipt(taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "10.00")], total="11.00"), "RCPT038")

    def test_total_must_equal_payment_sum_rcpt039(self):
        self.bad(receipt(taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "9.00")], total="10.00"), "RCPT039")

    def test_credit_note_total_must_not_be_positive_rcpt040(self):
        self.bad(receipt("CreditNote", taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "10.00")], total="10.00"), "RCPT028|RCPT040")

    @pytest.mark.parametrize("field,value", [("receiptType", "Refund"), ("receiptType", 9), ("receiptCurrency", "US"),
                                             ("receiptCurrency", "12$"), ("receiptTaxes", None), ("receiptPayments", "x")])
    def test_bad_receipt_fields_refused(self, field, value):
        r = receipt()
        r[field] = value
        self.bad(r, ".")

    def test_unknown_money_type_refused(self):
        self.bad(receipt(pays=[("Barter", "1.00")]), "moneyTypeCode")

    @pytest.mark.parametrize("bad_tax", [{"taxID": "3"}, {"taxID": -1}, {"taxID": True}, {"taxID": None}])
    def test_bad_tax_id_refused(self, bad_tax):
        t = {**tax(3, "15", "1.00", "0.13"), **bad_tax}
        self.bad(receipt(taxes=[t]), ".")

    @pytest.mark.parametrize("pct", [D("-1"), D("101"), True, "15"])
    def test_bad_tax_percent_refused(self, pct):
        t = tax(3, "15", "1.00", "0.13")
        t["taxPercent"] = pct
        self.bad(receipt(taxes=[t]), "percent")

    def test_failure_midway_leaves_counters_untouched(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(pays=[("Cash", "1.00")]))
        before = c.copy()
        with pytest.raises(CounterError):
            c.apply_receipt(receipt(taxes=[tax(3, "15", "5.00", "0.65")], pays=[("Cash", "5.00"), ("Barter", "1.00")]))
        assert c == before

    def test_non_object_receipt_refused(self):
        with pytest.raises(CounterError):
            FiscalDayCounters().apply_receipt([])           # type: ignore[arg-type]


# ----------------------------------------------------------------- wire / canonical
class TestWireAndCanonical:
    def make(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(taxes=[tax(1, None, "10.00", "0.00"), tax(3, "15.5", "115.00", "15.44")],
                                pays=[("Cash", "125.00")], total="125.00"))
        c.apply_receipt(receipt("CreditNote", taxes=[tax(3, "15.5", "-115.00", "-15.44")], pays=[("Cash", "-115.00")]))
        return c

    def test_wire_rows_are_nonzero_only_and_in_spec_order(self):
        rows = self.make().to_wire()
        # the exempt group's SaleTaxByTax is 0.00 and must be omitted (spec 4.11), so only ONE SaleTaxByTax row
        assert [r["fiscalCounterType"] for r in rows] == [
            "SaleByTax", "SaleByTax", "SaleTaxByTax", "CreditNoteByTax", "CreditNoteTaxByTax", "BalanceByMoneyType"]
        assert all(r["fiscalCounterValue"] != 0 for r in rows)

    def test_exempt_row_has_no_percent_and_money_row_has_no_tax_fields(self):
        rows = self.make().to_wire()
        exempt = next(r for r in rows if r.get("fiscalCounterTaxID") == 1 and r["fiscalCounterType"] == "SaleByTax")
        assert "fiscalCounterTaxPercent" not in exempt
        money = next(r for r in rows if r["fiscalCounterType"] == "BalanceByMoneyType")
        assert money["fiscalCounterMoneyType"] == "Cash" and "fiscalCounterTaxID" not in money
        assert money["fiscalCounterValue"] == D("10.00")

    def test_wire_roundtrip(self):
        c = self.make()
        assert FiscalDayCounters.from_wire(c.to_wire()) == c

    def test_from_wire_accepts_numeric_enums_and_none(self):
        c = FiscalDayCounters.from_wire([{"fiscalCounterType": 6, "fiscalCounterCurrency": "usd",
                                          "fiscalCounterMoneyType": 1, "fiscalCounterValue": D("3.00")}])
        assert val(c, C.BalanceByMoneyType, "USD", mt=M.Card) == D("3.00")
        assert FiscalDayCounters.from_wire(None) == FiscalDayCounters()

    @pytest.mark.parametrize("row", [
        {"fiscalCounterType": "SaleByTax", "fiscalCounterCurrency": "USD", "fiscalCounterValue": D("1.00")},          # no taxID
        {"fiscalCounterType": "BalanceByMoneyType", "fiscalCounterCurrency": "USD", "fiscalCounterValue": D("1.00")},  # no money type
        {"fiscalCounterType": "Nope", "fiscalCounterCurrency": "USD", "fiscalCounterValue": D("1.00")},
        {"fiscalCounterType": "SaleByTax", "fiscalCounterCurrency": "USD", "fiscalCounterTaxID": 1, "fiscalCounterValue": 1.0},
    ])
    def test_from_wire_rejects_malformed_rows(self, row):
        with pytest.raises(CounterError):
            FiscalDayCounters.from_wire([row])

    def test_no_zero_counter_ever_in_wire(self):
        c = FiscalDayCounters()
        c.apply_receipt(receipt(taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "10.00")]))
        c.apply_receipt(receipt("FiscalInvoice", taxes=[tax(3, "15", "0.00", "0.00")], pays=[]))
        c.add(CounterKey(C.SaleByTax, "USD", 3, D("15")), D("-10.00"))        # cancel a counter exactly
        assert all(r["fiscalCounterType"] != "SaleByTax" for r in c.to_wire())

    def test_canonical_counters_sort_all_seven_money_types_in_spec_order(self):
        c = FiscalDayCounters()
        for m in reversed(list(M)):
            c.apply_receipt(receipt(pays=[(m.name, "1.00")]))
        ordered = [x.money_type for x in sort_fiscal_day_counters(c.to_canonical())]
        assert ordered == [m.name for m in M]

    def test_spec_13_3_1_example_tail_reproduced_from_receipts(self):
        """The Fiscal-day signing-string tail from spec 13.3.1, built from RECEIPTS rather than hand-made counters."""
        c = FiscalDayCounters()
        c.apply_receipt(receipt(cur="USD", taxes=[tax(3, "15", "37.00", "2.50")], pays=[("Cash", "37.00")], total="37.00"))
        c.apply_receipt(receipt(cur="ZWL", taxes=[tax(3, "15", "35000.00", "2300.00")],
                                pays=[("Cash", "20000.00"), ("Card", "15000.00")], total="35000.00"))
        s = build_fiscal_day_signing_string(321, 84, "2019-09-23", c.to_canonical())
        assert s == ("321842019-09-23"
                     "SALEBYTAXUSD15.003700"
                     "SALEBYTAXZWL15.003500000"
                     "SALETAXBYTAXUSD15.00250"
                     "SALETAXBYTAXZWL15.00230000"
                     "BALANCEBYMONEYTYPEUSDCASH3700"
                     "BALANCEBYMONEYTYPEZWLCASH2000000"
                     "BALANCEBYMONEYTYPEZWLCARD1500000")


# -------------------------------------------------------------- rebuild / diff
def rec(n, counter, state, payload=None, day=1):
    return SimpleNamespace(receipt_global_no=n, receipt_counter=counter, fiscal_day_no=day, state=state, payload=payload)


class TestRebuild:
    P1 = receipt(taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "10.00")])
    P2 = receipt(taxes=[tax(3, "15", "20.00", "2.61")], pays=[("Card", "20.00")])

    def test_only_accepted_receipts_are_counted(self):
        rep = rebuild_day([rec(1, 1, R.ACCEPTED, self.P1), rec(2, 2, R.REJECTED, self.P2)], 1)
        assert rep.accepted_count == 1 and rep.rejected_count == 1 and rep.unresolved_count == 0
        assert val(rep.counters, C.SaleByTax, "USD", 3, "15") == D("10.00")
        assert rep.ready_to_close and rep.last_receipt_counter == 2           # rejected number is still "last"

    @pytest.mark.parametrize("state", [R.RESERVED, R.SIGNED, R.SUBMITTING, R.UNKNOWN])
    def test_unresolved_receipts_block_ready_to_close(self, state):
        rep = rebuild_day([rec(1, 1, R.ACCEPTED, self.P1), rec(2, 2, state, self.P2)], 1)
        assert rep.unresolved_count == 1 and not rep.ready_to_close
        assert val(rep.counters, C.SaleByTax, "USD", 3, "15") == D("10.00")   # not counted yet

    def test_other_days_are_ignored(self):
        rep = rebuild_day([rec(1, 1, R.ACCEPTED, self.P1, day=1), rec(2, 1, R.ACCEPTED, self.P2, day=2)], 2)
        assert rep.accepted_count == 1 and val(rep.counters, C.SaleByTax, "USD", 3, "15") == D("20.00")

    def test_empty_day(self):
        rep = rebuild_day([], 1)
        assert rep.counters.nonzero() == [] and rep.last_receipt_counter is None and rep.ready_to_close

    def test_accepted_receipt_without_payload_is_an_error(self):
        with pytest.raises(CounterError, match="no stored payload"):
            rebuild_day([rec(7, 1, R.ACCEPTED, None)], 1)

    def test_uncountable_receipt_names_itself(self):
        bad = receipt("CreditNote", pays=[("Cash", "5.00")])
        with pytest.raises(CounterError, match="receipt 9"):
            rebuild_day([rec(9, 1, R.ACCEPTED, bad)], 1)

    def test_rebuild_matches_running_total(self):
        running = FiscalDayCounters()
        for p in (self.P1, self.P2):
            running.apply_receipt(p)
        rep = rebuild_day([rec(1, 1, R.ACCEPTED, self.P1), rec(2, 2, R.ACCEPTED, self.P2)], 1)
        assert diff_counters(running, rep.counters) == []


class TestDiff:
    def test_agreement_is_empty_and_order_independent(self):
        a, b = FiscalDayCounters(), FiscalDayCounters()
        a.apply_receipt(receipt(pays=[("Cash", "1.00"), ("Card", "2.00")]))
        b.apply_receipt(receipt(pays=[("Card", "2.00"), ("Cash", "1.00")]))
        assert diff_counters(a, b) == []

    def test_differences_reported_with_missing_as_zero(self):
        a, b = FiscalDayCounters(), FiscalDayCounters()
        a.apply_receipt(receipt(pays=[("Cash", "10.00")]))
        b.apply_receipt(receipt(pays=[("Cash", "7.00"), ("Card", "1.00")]))
        diffs = diff_counters(a, b)
        assert [(d.key.money_type, d.expected, d.actual) for d in diffs] == [
            (M.Cash, D("10.00"), D("7.00")), (M.Card, D("0.00"), D("1.00"))]
        assert "expected 10.00, found 7.00" in diffs[0].describe()

    def test_server_reported_counters_compared_with_ledger(self):
        ledger = FiscalDayCounters()
        ledger.apply_receipt(receipt(taxes=[tax(3, "15", "10.00", "1.30")], pays=[("Cash", "10.00")]))
        server = FiscalDayCounters.from_wire(ledger.to_wire())
        assert diff_counters(ledger, server) == []
        tampered = ledger.to_wire()
        tampered[0]["fiscalCounterValue"] = D("9.99")
        assert [d.key.counter_type for d in diff_counters(ledger, FiscalDayCounters.from_wire(tampered))] == [C.SaleByTax]


# ---------------------------------------------------- against the real ledger
class TestWithStore:
    def test_counters_for_day_from_store_with_a_credit_note(self):
        s = FiscalStore(":memory:")
        s.register_device(1, "SN")
        s.begin_open_day(1, datetime(2026, 10, 1, 8))
        s.day_event(1, E.OPEN_CONFIRMED)

        def post(rtype, taxes, pays, accept=True):
            r = s.reserve_receipt(1, "USD", {})
            payload = {**receipt(rtype, taxes=taxes, pays=pays), "receiptGlobalNo": r.receipt_global_no,
                       "receiptCounter": r.receipt_counter}
            import base64, hashlib
            s.attach_signed(r.id, payload, base64.b64encode(hashlib.sha256(str(r.id).encode()).digest()).decode())
            s.begin_submit(r.id)
            if accept:
                s.mark_accepted(r.id, 100 + r.id, "d", {"hash": "h", "signature": "s"}, "OP")
            else:
                s.mark_rejected(r.id, "RCPT020")

        post("FiscalInvoice", [tax(3, "15.5", "115.00", "15.44")], [("Cash", "115.00")])
        post("FiscalInvoice", [tax(3, "15.5", "50.00", "6.71")], [("Card", "50.00")], accept=False)
        post("CreditNote", [tax(3, "15.5", "-23.00", "-3.09")], [("Cash", "-23.00")])
        rep = counters_for_day(s, 1, 1)
        assert (rep.accepted_count, rep.rejected_count, rep.ready_to_close, rep.last_receipt_counter) == (2, 1, True, 3)
        assert val(rep.counters, C.SaleByTax, "USD", 3, "15.5") == D("115.00")
        assert val(rep.counters, C.CreditNoteByTax, "USD", 3, "15.5") == D("-23.00")
        assert val(rep.counters, C.BalanceByMoneyType, "USD", mt=M.Cash) == D("92.00")
        assert val(rep.counters, C.BalanceByMoneyType, "USD", mt=M.Card) == 0          # the rejected card payment is excluded
        s.close()


class TestSourceHygiene:
    def test_no_float_and_no_qpd_imports(self):
        import pathlib
        text = (pathlib.Path(__import__("fiscal_core").__file__).parent / "counters.py").read_text(encoding="utf-8")
        assert "float(" not in text and "zimra_qpd" not in text


class TestFeedsCloseDay:
    def test_counter_wire_output_is_accepted_by_the_client_and_simulator(self, client, sim):
        import base64
        from fiscal_core.fdms_client import FiscalDayStatus
        client.open_day(datetime(2026, 10, 1, 8, 0, 0))
        c = FiscalDayCounters()
        c.apply_receipt(receipt(taxes=[tax(3, "15.5", "115.00", "15.44")], pays=[("Cash", "115.00")], total="115.00"))
        sig = {"hash": base64.b64encode(b"h" * 32).decode(), "signature": base64.b64encode(b"s" * 64).decode()}
        client.close_day(1, c.to_wire(), sig, 1)
        assert client.get_status().fiscal_day_status is FiscalDayStatus.CLOSE_INITIATED
        sent = sim.devices[next(iter(sim.devices))].close_payload["fiscalDayCounters"]
        assert FiscalDayCounters.from_wire(sent) == c                       # survives the JSON wire round-trip exactly

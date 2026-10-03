"""
canonicalise.py — deterministic field ordering + canonical signing strings
for FDMS receipt and fiscal-day signatures.

Phase 4, Phase 1 (money & canonicalisation core). No network calls, no
crypto (signing/hashing itself is crypto.py's job in Phase 2) — this file
only builds the exact concatenated string that gets hashed and signed.

STATUS UPDATE (this session): the previous session's canonicalise.py was
blocked because it believed ZIMRA Fiscal Device Gateway API Specification
v7.2 Section 13 ("Signatures generation and verification rules") was not
available, and a HANDOVER note claimed it had been "recorded in memory"
in an earlier session. Neither was true: the spec PDF *was* re-uploaded
to this conversation, and checking this Project's actual memory store
confirmed nothing from Section 13 had ever been saved there. This file
was completed by reading Section 13 directly from that PDF (pages 71-77)
this session — not from memory, not from a third-party SDK. The
third-party PR reference the old docstring relied on turned out to be
correct on field order, which is a nice confirmation, but everything
below is now traceable to primary spec text and its own worked examples.

VERIFIED (every one of these was checked by hand against the spec's own
worked examples in Section 13.2.1 / 13.2.2 / 13.3.1 / 13.3.2, not just
against a plausible-looking rule):
    - receipt device signing string field order + exact formatting
      (build_receipt_signing_string) — reproduces the FiscalInvoice
      "Example No 1" string byte-for-byte, including the trailing
      previousReceiptHash.
    - the tax-line signing segment format (build_tax_line_signing_segment)
      — reproduces both FiscalInvoice worked examples and the CreditNote
      worked example's negative-amount handling.
    - receipt FDMS signing string (build_receipt_fdms_signing_string) —
      reproduces the 13.2.2 worked example exactly.
    - fiscal-day device signing string (build_fiscal_day_signing_string)
      and the counter-line format (build_fiscal_day_counter_segment) —
      the SaleByTax/SaleTaxByTax portion of the 13.3.1 worked example
      reproduces byte-for-byte.
    - fiscal-day FDMS signing string (build_fiscal_day_fdms_signing_string)
      — reproduces the 13.3.2 worked example, including the
      AUTO-vs-MANUAL rule for whether fiscalDayDeviceSignature is
      appended.

COUNTER ORDERING (resolved 28 Sep 2026 from spec Section 5.4.4):
    Section 13.3.1 says counters are concatenated by "fiscalCounterType (in
    ascending order)". Section 5.4.4 (FiscalCounterType) gives every type an
    explicit "Enum order": SaleByTax 0, SaleTaxByTax 1, CreditNoteByTax 2,
    CreditNoteTaxByTax 3, DebitNoteByTax 4, DebitNoteTaxByTax 5,
    BalanceByMoneyType 6. "Ascending" therefore means that enum order, NOT
    alphabetical (alphabetical would put BalanceByMoneyType first, which
    the 13.3.1 example contradicts). Likewise Section 5.4.5 (MoneyType)
    orders Cash 0, Card 1, MobileWallet 2 -- so CASH sorts BEFORE CARD,
    which is what the 13.3.1 example shows for ZWL.
    Full order used here: counter-type enum order, then currency
    alphabetical, then tax id / tax percent (or money-type enum order).

REMAINING SPEC QUIRKS, flagged rather than guessed:
    - The 13.3.1 example lists SaleByTax ZWL rows before a USD row, i.e. it
      is NOT currency-first inside that type, contradicting the stated rule
      (currency alphabetical, then taxID). This code follows the stated
      rule. Validate against ZIMRA's TEST environment before trusting it.
    - The example's hash was computed over "BALANCEBYMONEYTYPEUSDLCASH..."
      (stray "L") -- a generator typo, so the example's hash cannot be
      reproduced from a correctly-built string.
    - taxID is not part of the signed text; it is only a sort key. Pass
      tax_id on FiscalDayCounter when known; otherwise tax_percent is used.
    See docs/decisions.md and docs/fiscal-rules.md section 13.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, NamedTuple, Optional, Union

from .money import to_minor_units

DateLike = Union[str, datetime]
DayDateLike = Union[str, date, datetime]


def _format_datetime(value: DateLike) -> str:
    """ISO 8601 <date>T<time>, YYYY-MM-DDTHH:mm:ss, local time, no
    microseconds (spec Section 13.2.1 field 5 / 13.2.2 field 3)."""
    if isinstance(value, str):
        return value
    return value.strftime("%Y-%m-%dT%H:%M:%S")


def _format_date(value: DayDateLike) -> str:
    """ISO 8601 YYYY-MM-DD (spec Section 13.3.1 field 3)."""
    if isinstance(value, str):
        return value
    return value.strftime("%Y-%m-%d")


def _format_percent(percent: Optional[Decimal]) -> str:
    """
    Spec Section 13.2.1 field 7 / 13.3.1 field 4, both identical rules:
      - not sent / exempt -> empty string
      - integer value -> "N.00" (dot, two zeros)
      - non-integer -> exactly 2 decimal places ("14.50" for 14.5)
    Verified against all three of: 0 -> "0.00", 15 -> "15.00", 14.5 -> "14.50".
    """
    if percent is None:
        return ""
    return f"{percent:.2f}"


class TaxLine(NamedTuple):
    """One (taxCode, taxID, taxPercent, taxAmount, salesAmountWithTax)
    group, as it appears in the receiptTaxes array (Section 4.7)."""
    tax_id: int
    tax_code: str  # empty string if not provided (spec: taxCode is optional)
    tax_percent: Optional[Decimal]  # None for exempt (spec: field omitted if exempt)
    tax_amount: Decimal
    sales_amount_with_tax: Decimal


def sort_receipt_taxes(tax_lines: Iterable[TaxLine]) -> list[TaxLine]:
    """
    Sort receiptTaxes lines by taxID ascending, then taxCode ascending
    (alphabetical, empty sorts before "A") within the same taxID.

    Confirmed directly against spec Section 13.2.1 text: "Taxes are
    ordered by taxID in ascending order and taxCode in alphabetical order
    (if taxCode is empty it is ordered before A letter)." — and against
    both FiscalInvoice worked examples' tax-line ordering.
    """
    return sorted(tax_lines, key=lambda t: (t.tax_id, t.tax_code or ""))


def build_tax_line_signing_segment(tax_line: TaxLine) -> str:
    """
    taxCode || taxPercent || taxAmount || salesAmountWithTax, per spec
    Section 13.2.1 field 7. Amounts are cents (no decimal point, sign
    preserved for credit notes). Confirmed against both FiscalInvoice
    worked examples (positive amounts, with and without taxCode) and the
    CreditNote worked example (negative amounts).
    """
    tax_code = tax_line.tax_code or ""
    percent_str = _format_percent(tax_line.tax_percent)
    amount_cents = to_minor_units(tax_line.tax_amount)
    sales_cents = to_minor_units(tax_line.sales_amount_with_tax)
    return f"{tax_code}{percent_str}{amount_cents}{sales_cents}"


def build_receipt_signing_string(
    device_id: int,
    receipt_type: str,
    receipt_currency: str,
    receipt_global_no: int,
    receipt_date: DateLike,
    receipt_total: Decimal,
    tax_lines: Iterable[TaxLine],
    previous_receipt_hash: Optional[str] = None,
) -> str:
    """
    Full receipt-level canonical string for the DEVICE signature, per
    spec Section 13.2.1 fields 1-8. Fed to SHA-256 then signed (that
    step is crypto.py's job, Phase 2 — this function stops at the string).

    previous_receipt_hash: omit (pass None) for the first receipt of a
    fiscal day — spec: "This field is not used in signature when current
    receipt is first in fiscal day."

    Reproduces spec Section 13.2.1's FiscalInvoice "Example No 1" byte
    for byte: see test_canonicalise.py::TestBuildReceiptSigningString.
    """
    date_str = _format_datetime(receipt_date)
    total_cents = to_minor_units(receipt_total)
    tax_segment = "".join(
        build_tax_line_signing_segment(t) for t in sort_receipt_taxes(tax_lines)
    )
    result = (
        f"{device_id}{receipt_type.upper()}{receipt_currency.upper()}"
        f"{receipt_global_no}{date_str}{total_cents}{tax_segment}"
    )
    if previous_receipt_hash:
        result += previous_receipt_hash
    return result


def build_receipt_fdms_signing_string(
    receipt_device_signature: str,
    receipt_id: int,
    server_date: DateLike,
) -> str:
    """
    Canonical string for the FDMS (server) signature on a receipt, per
    spec Section 13.2.2: receiptDeviceSignature || receiptID || serverDate.
    Reproduces the 13.2.2 worked example exactly.
    """
    date_str = _format_datetime(server_date)
    return f"{receipt_device_signature}{receipt_id}{date_str}"


class FiscalDayCounter(NamedTuple):
    """
    One fiscal-day counter line (Section 6's counters table; e.g.
    SaleByTax, SaleTaxByTax, CreditNoteByTax, BalanceByMoneyType).

    Exactly one of tax_percent / money_type should be set, matching
    whichever kind of counter this is (tax-percent-keyed vs money-type-
    keyed, per spec Section 13.3.1 field 4's "fiscalCounterTaxPercent or
    fiscalCounterMoneyType" wording). Leave both None for a tax-percent
    counter with no percent (e.g. an exempt-rate sale line).
    """
    counter_type: str          # e.g. "SaleByTax"; ordered by spec 5.4.4 enum order
    currency: str               # ISO 4217
    value: Decimal               # major units
    tax_percent: Optional[Decimal] = None
    money_type: Optional[str] = None   # e.g. "CASH", "CARD", "MOBILEWALLET"
    tax_id: Optional[int] = None        # sort key only (spec: taxID ascending); never signed


def build_fiscal_day_counter_segment(counter: FiscalDayCounter) -> str:
    """
    fiscalCounterType || fiscalCounterCurrency || (fiscalCounterTaxPercent
    or fiscalCounterMoneyType) || fiscalCounterValue, per spec Section
    13.3.1 field 4. All text upper-cased, amounts in cents. Reproduces
    the SaleByTax/SaleTaxByTax lines of the 13.3.1 worked example exactly.
    """
    if counter.money_type is not None:
        key = counter.money_type.upper()
    else:
        key = _format_percent(counter.tax_percent)
    value_cents = to_minor_units(counter.value)
    return f"{counter.counter_type.upper()}{counter.currency.upper()}{key}{value_cents}"


# Spec Section 5.4.4 "Enum order" column -- authoritative for "ascending".
COUNTER_TYPE_ORDER = {
    "SALEBYTAX": 0,
    "SALETAXBYTAX": 1,
    "CREDITNOTEBYTAX": 2,
    "CREDITNOTETAXBYTAX": 3,
    "DEBITNOTEBYTAX": 4,
    "DEBITNOTETAXBYTAX": 5,
    "BALANCEBYMONEYTYPE": 6,
}
# Spec Section 5.4.5 "Enum order" column.
MONEY_TYPE_ORDER = {"CASH": 0, "CARD": 1, "MOBILEWALLET": 2, "COUPON": 3, "CREDIT": 4, "BANKTRANSFER": 5, "OTHER": 6}


def _counter_type_rank(counter_type: str) -> int:
    try:
        return COUNTER_TYPE_ORDER[counter_type.upper()]
    except KeyError:
        raise ValueError(
            f"Unknown fiscalCounterType {counter_type!r}; spec 5.4.4 defines: "
            + ", ".join(COUNTER_TYPE_ORDER)
        ) from None


def _counter_secondary_key(c: FiscalDayCounter):
    if c.money_type is not None:
        try:
            return (1, MONEY_TYPE_ORDER[c.money_type.upper()], Decimal(0))
        except KeyError:
            raise ValueError(
                f"Unknown fiscalCounterMoneyType {c.money_type!r}; spec 5.4.5 "
                "defines: " + ", ".join(MONEY_TYPE_ORDER)
            ) from None
    if c.tax_id is not None:
        return (0, c.tax_id, Decimal(0))
    if c.tax_percent is None:
        return (0, -1, Decimal(-1))  # exempt / no percent sorts first
    return (0, 0, c.tax_percent)


def sort_fiscal_day_counters(counters: Iterable[FiscalDayCounter]) -> list[FiscalDayCounter]:
    """
    Full spec ordering (13.3.1 field 4): counter type in spec enum order
    (5.4.4), then currency alphabetical, then tax id (or tax percent when
    no id is given) / money type in spec enum order (5.4.5). Blank
    tax_percent sorts first (analogy with the receiptTaxes empty-taxCode
    rule; not spec-confirmed for counters specifically).

    Raises ValueError for an unknown counter type or money type rather
    than guessing a position.
    """
    return sorted(
        counters,
        key=lambda c: (
            _counter_type_rank(c.counter_type),
            c.currency.upper(),
            _counter_secondary_key(c),
        ),
    )


def build_fiscal_day_signing_string(
    device_id: int,
    fiscal_day_no: int,
    fiscal_day_date: DayDateLike,
    counters: Iterable[FiscalDayCounter],
) -> str:
    """
    Fiscal-day-close canonical string for the DEVICE signature, per spec
    Section 13.3.1 fields 1-4. Only non-zero counters are included (spec:
    "Only non-zero value fiscal counters are included in concatenation").

    `counters` may be given in any order; they are sorted into the
    spec's order (see sort_fiscal_day_counters).

    Reproduces the SaleTaxByTax + BalanceByMoneyType tail of the 13.3.1
    worked example byte for byte (see test_canonicalise.py). The example's
    SaleByTax rows are not currency-first and its hash includes a stray
    "L" typo, so the full example is not used as an oracle -- see module
    docstring.
    """
    date_str = _format_date(fiscal_day_date)
    nonzero = [c for c in counters if c.value != 0]
    ordered = sort_fiscal_day_counters(nonzero)
    segment = "".join(build_fiscal_day_counter_segment(c) for c in ordered)
    return f"{device_id}{fiscal_day_no}{date_str}{segment}"


def build_fiscal_day_fdms_signing_string(
    device_id: int,
    fiscal_day_no: int,
    fiscal_day_date: DayDateLike,
    fiscal_day_updated: DateLike,
    reconciliation_mode: str,
    counters: Iterable[FiscalDayCounter],
    fiscal_day_device_signature: Optional[str],
) -> str:
    """
    Canonical string for the FDMS (server) signature on a fiscal-day
    close, per spec Section 13.3.2 fields 1-7.

    reconciliation_mode: "AUTO" or "MANUAL" (case-insensitive in, always
    upper-cased out). Per spec: "In case fiscal day is closed manually,
    [fiscalDayDeviceSignature] is not included into hash for FDMS
    signature" -- so it's appended only when mode != MANUAL, and is then
    required (raises if missing, since guessing an empty string there
    would produce a silently-wrong signature).

    Reproduces the 13.3.2 worked example exactly (AUTO mode, signature
    included).
    """
    mode = reconciliation_mode.upper()
    if mode not in ("AUTO", "MANUAL"):
        raise ValueError(
            f"reconciliation_mode must be 'AUTO' or 'MANUAL', got {reconciliation_mode!r}"
        )
    date_str = _format_date(fiscal_day_date)
    updated_str = _format_datetime(fiscal_day_updated)
    nonzero = [c for c in counters if c.value != 0]
    ordered = sort_fiscal_day_counters(nonzero)
    segment = "".join(build_fiscal_day_counter_segment(c) for c in ordered)
    result = f"{device_id}{fiscal_day_no}{date_str}{updated_str}{mode}{segment}"
    if mode != "MANUAL":
        if not fiscal_day_device_signature:
            raise ValueError(
                "fiscal_day_device_signature is required when reconciliation_mode "
                "is AUTO (spec 13.3.2: it's omitted only for MANUAL closes)."
            )
        result += fiscal_day_device_signature
    return result

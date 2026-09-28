"""
money.py — Decimal-only monetary arithmetic for ZIMRA FDMS fiscalisation.

Phase 4, Phase 1 (money & canonicalisation core). No network calls. No
platform imports beyond the stdlib `decimal` module.

Every rule enforced here is traceable to ZIMRA Fiscal Device Gateway API
Specification v7.2, Section 4.7 (submitReceipt / RCPTxxx validation rules)
and Section 6 (fiscal counters) — verified directly against the live spec
text fetched 25 Sep 2026, not from a third-party summary. See
`docs/decisions.md` for the verification note.

Design decision: Decimal end-to-end, never float. A `float` anywhere in
this module is a bug — see docs/security.md's non-negotiables list.
ROUND_HALF_UP throughout, matching the rounding discipline already
established in phase1-engine's QPD money.py (per HANDOVER.md).

Field precision, per the spec's own Decimal(x,y) column (x = total digits,
y = decimal places):
    - Money totals (receiptTotal, receiptLineTotal, taxAmount,
      salesAmountWithTax, paymentAmount, fiscalCounterValue): 2 decimal
      places.
    - Tax percent (taxPercent): 2 decimal places.
    - Quantity (receiptLineQuantity) and unit price (receiptLinePrice):
      6 decimal places.

This module works in Decimal "major units" (e.g. Decimal("28.75") for
$28.75), not integer cents — the spec's JSON wire format sends decimal
values directly (see the worked file example in Section 4.9.1, e.g.
"receiptTotal": 28.75), so minor-units conversion is provided as a utility
for internal accumulation/storage, not as the wire representation.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Iterable, Union

# --- Precision constants, per spec Section 4.7/5 Decimal(x,y) columns ---
MONEY_PLACES = 2       # Decimal(21,2) / Decimal(19,2) fields
PERCENT_PLACES = 2     # Decimal(5,2) — taxPercent
QUANTITY_PLACES = 6    # Decimal(25,6) — receiptLineQuantity, receiptLinePrice

_MONEY_QUANT = Decimal(1).scaleb(-MONEY_PLACES)        # Decimal("0.01")
_PERCENT_QUANT = Decimal(1).scaleb(-PERCENT_PLACES)    # Decimal("0.01")
_QUANTITY_QUANT = Decimal(1).scaleb(-QUANTITY_PLACES)  # Decimal("0.000001")

Numeric = Union[Decimal, str, int]


class MoneyError(ValueError):
    """Raised for any monetary value that cannot be safely represented."""


def to_decimal(value: Numeric) -> Decimal:
    """
    Convert a value to Decimal, safely.

    Deliberately rejects `float` outright — a float has already lost
    precision by the time it reaches this function (e.g. 0.1 + 0.2 !=
    0.3), and there is no way to recover the "correct" decimal from it
    after the fact. Callers must supply str, int, or Decimal.
    """
    if isinstance(value, float):
        raise MoneyError(
            f"Refusing to convert float {value!r} to Decimal — floats lose "
            "precision before they reach this function. Pass a str (e.g. "
            "'28.75') or an int, or a Decimal you already hold."
        )
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (str, int)):
        try:
            return Decimal(value)
        except InvalidOperation as exc:
            raise MoneyError(f"Cannot convert {value!r} to Decimal") from exc
    raise MoneyError(f"Unsupported type for monetary value: {type(value)!r}")


def round_money(value: Numeric) -> Decimal:
    """Round to MONEY_PLACES (2dp) using ROUND_HALF_UP."""
    d = to_decimal(value)
    return d.quantize(_MONEY_QUANT, rounding=ROUND_HALF_UP)


def round_percent(value: Numeric) -> Decimal:
    """Round a tax percent to PERCENT_PLACES (2dp) using ROUND_HALF_UP."""
    d = to_decimal(value)
    return d.quantize(_PERCENT_QUANT, rounding=ROUND_HALF_UP)


def round_quantity(value: Numeric) -> Decimal:
    """Round a quantity/price to QUANTITY_PLACES (6dp) using ROUND_HALF_UP."""
    d = to_decimal(value)
    return d.quantize(_QUANTITY_QUANT, rounding=ROUND_HALF_UP)


def to_minor_units(value: Numeric, places: int = MONEY_PLACES) -> int:
    """
    Convert a Decimal major-unit amount to an integer minor-unit amount
    (e.g. Decimal("28.75") -> 2875 cents), for internal accumulation/
    storage. Rounds via ROUND_HALF_UP first if the value has more
    precision than `places`.
    """
    d = to_decimal(value)
    quant = Decimal(1).scaleb(-places)
    rounded = d.quantize(quant, rounding=ROUND_HALF_UP)
    return int((rounded * (10 ** places)).to_integral_value(rounding=ROUND_HALF_UP))


def from_minor_units(minor: int, places: int = MONEY_PLACES) -> Decimal:
    """Convert an integer minor-unit amount back to a Decimal major-unit amount."""
    if not isinstance(minor, int):
        raise MoneyError(f"from_minor_units requires an int, got {type(minor)!r}")
    quant = Decimal(1).scaleb(-places)
    return (Decimal(minor) * quant).quantize(quant, rounding=ROUND_HALF_UP)


def format_money(value: Numeric) -> str:
    """
    Format a monetary Decimal as a fixed-2dp string for JSON wire output,
    e.g. Decimal("28.7") -> "28.70". Never use Python's default float/str
    formatting for wire output — this guarantees trailing zeros are kept
    (FDMS' own worked examples show e.g. "receiptTotal": 28.75, always
    with exactly 2dp).
    """
    return str(round_money(value))


def sum_money(values: Iterable[Numeric]) -> Decimal:
    """Sum a sequence of monetary values, each individually coerced via
    to_decimal first (so a stray float raises immediately rather than
    silently corrupting the total). Does NOT round the result — callers
    round at the point mandated by the specific validation rule being
    implemented (see calc_tax_amount_* below for the two rules that do
    round)."""
    total = Decimal("0")
    for v in values:
        total += to_decimal(v)
    return total


# --- Tax arithmetic, directly from spec RCPT026/RCPT027 (Section 4.7) ---
#
# Spec text (verified, Section 4.7, ReceiptTax.taxAmount validation RCPT026):
#   "taxAmount must be equal to SUM(receiptLineTotal) * taxPercent/(1+taxPercent)
#    ... in case receiptLinesTaxInclusive is true"
#   "taxAmount must be equal to SUM(receiptLineTotal) * taxPercent
#    ... in case receiptLinesTaxInclusive is false"
#
# And RCPT027 (salesAmountWithTax):
#   "salesAmountWithTax must be equal to sum of receiptLineTotal ...
#    in case receiptLinesTaxInclusive is true"
#   "salesAmountWithTax must be equal to SUM(receiptLineTotal)*(1+taxPercent)
#    ... in case receiptLinesTaxInclusive is false"


def calc_tax_amount(
    line_totals: Iterable[Numeric],
    tax_percent: Numeric,
    tax_inclusive: bool,
) -> Decimal:
    """
    Tax amount for one (taxPercent, taxCode) group of receipt lines,
    per RCPT026. `tax_percent` is a whole-number-style percent (e.g. 15
    for 15%, matching the spec's own taxPercent field), not a fraction.
    Result rounded to 2dp with ROUND_HALF_UP.
    """
    total = sum_money(line_totals)
    pct = to_decimal(tax_percent) / Decimal(100)
    if tax_inclusive:
        amount = total * pct / (Decimal(1) + pct)
    else:
        amount = total * pct
    return round_money(amount)


def calc_sales_amount_with_tax(
    line_totals: Iterable[Numeric],
    tax_percent: Numeric,
    tax_inclusive: bool,
) -> Decimal:
    """
    Sales amount including tax for one (taxPercent, taxCode) group,
    per RCPT027. Result rounded to 2dp with ROUND_HALF_UP.
    """
    total = sum_money(line_totals)
    if tax_inclusive:
        return round_money(total)
    pct = to_decimal(tax_percent) / Decimal(100)
    return round_money(total * (Decimal(1) + pct))


def calc_line_total(price: Numeric, quantity: Numeric) -> Decimal:
    """
    receiptLineTotal = receiptLinePrice * receiptLineQuantity, per RCPT024.
    price/quantity carry 6dp precision; the product is rounded to 2dp
    (money) since receiptLineTotal is a Decimal(21,2) field.
    """
    p = to_decimal(price)
    q = to_decimal(quantity)
    return round_money(p * q)

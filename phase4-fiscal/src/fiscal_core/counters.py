"""
counters.py - fiscal-day counters, spec section 6 (Phase 4 / P6). PURE: no I/O.

THE RULES (spec section 6, read in full)
  Every submitted receipt updates counters, keyed by tax, currency and/or payment method:

      FiscalInvoice : SaleByTax        += salesAmountWithTax   (per receiptTaxes entry)
                      SaleTaxByTax     += taxAmount
      CreditNote    : CreditNoteByTax  += salesAmountWithTax   (amounts are NEGATIVE as sent)
                      CreditNoteTaxByTax += taxAmount
      DebitNote     : DebitNoteByTax   += salesAmountWithTax
                      DebitNoteTaxByTax += taxAmount
      all three     : BalanceByMoneyType += paymentAmount      (per receiptPayments entry)

  * Amounts are added AS SENT. A credit note carries negative amounts (RCPT028 / RCPT040), so its
    counters decrease with no special-casing. "Discount" lines are already netted into the
    receiptTaxes amounts ("after discount", spec section 6), so only receiptTaxes and
    receiptPayments are read here.
  * Counters are per currency. USD and ZiG are NEVER netted (same rule as Section 37AA in QPD).
  * Zero-value counters are omitted when closing the day (spec 4.11); they are still tracked here
    because a later receipt can move them again.
  * Counters reset every fiscal day: a FiscalDayCounters instance is for ONE day.

WHICH RECEIPTS COUNT
  Only receipts the ledger holds as ACCEPTED. A receipt rejected with a 422 is not in FDMS's
  counters. UNKNOWN / SUBMITTING / SIGNED / RESERVED receipts are not counted yet, and
  `ready_to_close` is False while any exist (closing with them would fail "MissingReceipts").
  OPEN QUESTION S10: does FDMS count a receipt that it ACCEPTED but flagged with a "Red"
  validation error? Red receipts block closeDay anyway (spec 4.11), so this only matters once
  such a receipt exists; settle in P13.

THE LEDGER IS THE SOURCE OF TRUTH
  `rebuild_day()` recomputes a day's counters from the stored receipts. Compare with a
  running total, or with what FDMS reports (`FiscalDayCounters.from_wire(getStatus counters)`),
  using `diff_counters()`. A non-empty diff means a bug or a missing receipt; it must be
  investigated before closing the day, never papered over.

WIRE FORMAT CAVEAT
  Enum fields are emitted as names ("SaleByTax", "Cash"); the v7.2 text does not say whether the
  gateway wants names or numbers (see fdms_client). from_wire() accepts both.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, Iterable, List, Mapping, NamedTuple, Optional, Tuple

from .canonicalise import FiscalDayCounter
from .money import MoneyError, to_decimal
from .state import ReceiptState

_CENT = Decimal("0.01")


class CounterError(ValueError):
    """A receipt or counter could not be counted safely. Nothing is changed when this is raised."""


# -------------------------------------------------------------------- enums
class CounterType(int, Enum):                    # spec 5.4.4, enum order = value
    SaleByTax = 0
    SaleTaxByTax = 1
    CreditNoteByTax = 2
    CreditNoteTaxByTax = 3
    DebitNoteByTax = 4
    DebitNoteTaxByTax = 5
    BalanceByMoneyType = 6


class MoneyType(int, Enum):                      # spec 5.4.5
    Cash = 0
    Card = 1
    MobileWallet = 2
    Coupon = 3
    Credit = 4
    BankTransfer = 5
    Other = 6


class ReceiptType(int, Enum):                    # spec 5.4.6
    FiscalInvoice = 0
    CreditNote = 1
    DebitNote = 2


_BY_TAX_FOR = {
    ReceiptType.FiscalInvoice: (CounterType.SaleByTax, CounterType.SaleTaxByTax),
    ReceiptType.CreditNote: (CounterType.CreditNoteByTax, CounterType.CreditNoteTaxByTax),
    ReceiptType.DebitNote: (CounterType.DebitNoteByTax, CounterType.DebitNoteTaxByTax),
}
_TAX_COUNTERS = frozenset(c for pair in _BY_TAX_FOR.values() for c in pair)


def _parse_enum(value: Any, cls: type, what: str) -> Any:
    if isinstance(value, bool):
        raise CounterError(f"{what}: unexpected boolean")
    if isinstance(value, int):
        try:
            return cls(value)
        except ValueError:
            raise CounterError(f"{what}: unknown value {value}") from None
    if isinstance(value, str):
        norm = value.strip().lower()
        for member in cls:
            if member.name.lower() == norm:
                return member
    raise CounterError(f"{what}: unrecognised value {value!r}")


def _money(value: Any, what: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (Decimal, int)):
        raise CounterError(f"{what}: must be a Decimal or int amount, got {type(value).__name__}")
    try:
        d = to_decimal(value)
    except MoneyError as exc:                                   # pragma: no cover - defensive
        raise CounterError(f"{what}: {exc}") from None
    if not d.is_finite() or d != d.quantize(_CENT):
        raise CounterError(f"{what}: {value!r} is not a whole number of cents (spec: Decimal(21,2))")
    return d


def _percent(value: Any, what: str) -> Optional[Decimal]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (Decimal, int)):
        raise CounterError(f"{what}: must be a Decimal or int percent")
    d = Decimal(value)
    if not d.is_finite() or d < 0 or d > 100:
        raise CounterError(f"{what}: {value!r} is not a valid percent")
    return d


def _currency(value: Any, what: str) -> str:
    if not isinstance(value, str) or len(value) != 3 or not value.isalpha():
        raise CounterError(f"{what}: must be a 3-letter ISO 4217 code")
    return value.upper()


# --------------------------------------------------------------------- keys
class CounterKey(NamedTuple):
    counter_type: CounterType
    currency: str
    tax_id: Optional[int] = None                 # by-tax counters
    tax_percent: Optional[Decimal] = None        # None for exempt
    money_type: Optional[MoneyType] = None       # BalanceByMoneyType only

    def label(self) -> str:
        if self.counter_type is CounterType.BalanceByMoneyType:
            return f"{self.counter_type.name} {self.currency} {self.money_type.name if self.money_type else '?'}"
        pct = "exempt" if self.tax_percent is None else f"{self.tax_percent}%"
        return f"{self.counter_type.name} {self.currency} taxID={self.tax_id} ({pct})"


def _sort_key(k: CounterKey) -> Tuple:
    return (k.counter_type.value, k.currency,
            k.money_type.value if k.money_type is not None else -1,
            k.tax_id if k.tax_id is not None else -1,
            k.tax_percent if k.tax_percent is not None else Decimal(-1))


def _validated_key(counter_type: CounterType, currency: str, tax_id: Optional[int],
                   tax_percent: Optional[Decimal], money_type: Optional[MoneyType]) -> CounterKey:
    if counter_type is CounterType.BalanceByMoneyType:
        if money_type is None or tax_id is not None or tax_percent is not None:
            raise CounterError("BalanceByMoneyType needs a money type and no tax fields")
    else:
        if tax_id is None or money_type is not None:
            raise CounterError(f"{counter_type.name} needs a taxID and no money type")
        if isinstance(tax_id, bool) or not isinstance(tax_id, int) or tax_id < 0:
            raise CounterError("taxID must be a non-negative int")
    return CounterKey(counter_type, currency, tax_id, tax_percent, money_type)


# ----------------------------------------------------------------- counters
class FiscalDayCounters:
    """Running counters for ONE fiscal day."""

    def __init__(self) -> None:
        self._v: Dict[CounterKey, Decimal] = {}

    # ---- reading
    def value(self, key: CounterKey) -> Decimal:
        return self._v.get(key, Decimal("0.00"))

    def items(self) -> List[Tuple[CounterKey, Decimal]]:
        return sorted(self._v.items(), key=lambda kv: _sort_key(kv[0]))

    def nonzero(self) -> List[Tuple[CounterKey, Decimal]]:
        return [(k, v) for k, v in self.items() if v != 0]

    def __eq__(self, other: object) -> bool:
        return isinstance(other, FiscalDayCounters) and self.nonzero() == other.nonzero()

    def __repr__(self) -> str:
        return f"FiscalDayCounters({len(self.nonzero())} non-zero)"

    def copy(self) -> "FiscalDayCounters":
        c = FiscalDayCounters()
        c._v = dict(self._v)
        return c

    # ---- writing
    def add(self, key: CounterKey, delta: Decimal) -> None:
        self._v[key] = self.value(key) + delta

    def apply_receipt(self, receipt: Mapping[str, Any]) -> None:
        """Count one ACCEPTED receipt (wire-format dict). Validates everything first; on error nothing changes."""
        for key, delta in _receipt_deltas(receipt):
            self.add(key, delta)

    # ---- output
    def to_wire(self) -> List[Dict[str, Any]]:
        """closeDay `fiscalDayCounters`: non-zero only (spec 4.11), spec enum order."""
        out: List[Dict[str, Any]] = []
        for k, v in self.nonzero():
            row: Dict[str, Any] = {"fiscalCounterType": k.counter_type.name, "fiscalCounterCurrency": k.currency}
            if k.counter_type is CounterType.BalanceByMoneyType:
                row["fiscalCounterMoneyType"] = k.money_type.name        # type: ignore[union-attr]
            else:
                row["fiscalCounterTaxID"] = k.tax_id
                if k.tax_percent is not None:                           # exempt: field must not be sent
                    row["fiscalCounterTaxPercent"] = k.tax_percent
            row["fiscalCounterValue"] = v
            out.append(row)
        return out

    def to_canonical(self) -> List[FiscalDayCounter]:
        """Input for canonicalise.build_fiscal_day_signing_string (non-zero only)."""
        out = []
        for k, v in self.nonzero():
            if k.counter_type is CounterType.BalanceByMoneyType:
                out.append(FiscalDayCounter(k.counter_type.name, k.currency, v, money_type=k.money_type.name))  # type: ignore[union-attr]
            else:
                out.append(FiscalDayCounter(k.counter_type.name, k.currency, v, tax_percent=k.tax_percent, tax_id=k.tax_id))
        return out

    @classmethod
    def from_wire(cls, rows: Optional[Iterable[Mapping[str, Any]]]) -> "FiscalDayCounters":
        """Parse counters as FDMS reports them (e.g. getStatus fiscalDayCounters). Names or numbers accepted."""
        c = cls()
        for i, row in enumerate(rows or ()):
            if not isinstance(row, Mapping):
                raise CounterError(f"counter {i}: not an object")
            ctype = _parse_enum(row.get("fiscalCounterType"), CounterType, f"counter {i} type")
            cur = _currency(row.get("fiscalCounterCurrency"), f"counter {i} currency")
            val = _money(row.get("fiscalCounterValue"), f"counter {i} value")
            mt = row.get("fiscalCounterMoneyType")
            tid = row.get("fiscalCounterTaxID")
            key = _validated_key(
                ctype, cur,
                None if ctype is CounterType.BalanceByMoneyType else tid,
                None if ctype is CounterType.BalanceByMoneyType else _percent(row.get("fiscalCounterTaxPercent"), f"counter {i} percent"),
                _parse_enum(mt, MoneyType, f"counter {i} money type") if ctype is CounterType.BalanceByMoneyType else None)
            c.add(key, val)
        return c


def _receipt_deltas(receipt: Mapping[str, Any]) -> List[Tuple[CounterKey, Decimal]]:
    if not isinstance(receipt, Mapping):
        raise CounterError("receipt must be an object")
    rtype = _parse_enum(receipt.get("receiptType"), ReceiptType, "receiptType")
    cur = _currency(receipt.get("receiptCurrency"), "receiptCurrency")
    sales_ctr, tax_ctr = _BY_TAX_FOR[rtype]
    taxes, pays = receipt.get("receiptTaxes"), receipt.get("receiptPayments")
    if not isinstance(taxes, (list, tuple)) or not isinstance(pays, (list, tuple)):
        raise CounterError("receiptTaxes and receiptPayments must be arrays")

    deltas: List[Tuple[CounterKey, Decimal]] = []
    sales_sum = Decimal("0.00")
    for i, t in enumerate(taxes):
        if not isinstance(t, Mapping):
            raise CounterError(f"receiptTaxes[{i}]: not an object")
        tid = t.get("taxID")
        pct = _percent(t.get("taxPercent"), f"receiptTaxes[{i}].taxPercent")
        sales = _money(t.get("salesAmountWithTax"), f"receiptTaxes[{i}].salesAmountWithTax")
        tax = _money(t.get("taxAmount"), f"receiptTaxes[{i}].taxAmount")
        deltas.append((_validated_key(sales_ctr, cur, tid, pct, None), sales))
        deltas.append((_validated_key(tax_ctr, cur, tid, pct, None), tax))
        sales_sum += sales

    pay_sum = Decimal("0.00")
    for i, p in enumerate(pays):
        if not isinstance(p, Mapping):
            raise CounterError(f"receiptPayments[{i}]: not an object")
        mt = _parse_enum(p.get("moneyTypeCode"), MoneyType, f"receiptPayments[{i}].moneyTypeCode")
        amt = _money(p.get("paymentAmount"), f"receiptPayments[{i}].paymentAmount")
        # RCPT028: payments are >= 0 for invoices and debit notes, <= 0 for credit notes.
        if (rtype is ReceiptType.CreditNote and amt > 0) or (rtype is not ReceiptType.CreditNote and amt < 0):
            raise CounterError(f"receiptPayments[{i}]: paymentAmount {amt} has the wrong sign for a {rtype.name} (RCPT028)")
        deltas.append((_validated_key(CounterType.BalanceByMoneyType, cur, None, None, mt), amt))
        pay_sum += amt

    if "receiptTotal" in receipt:                   # RCPT038 / RCPT039: a receipt that disagrees with itself is Red
        total = _money(receipt["receiptTotal"], "receiptTotal")
        if total != sales_sum or total != pay_sum:
            raise CounterError(f"receiptTotal {total} must equal the sum of salesAmountWithTax ({sales_sum}) "
                               f"and of paymentAmount ({pay_sum}) (RCPT038/RCPT039)")
        if (rtype is ReceiptType.CreditNote and total > 0) or (rtype is not ReceiptType.CreditNote and total < 0):
            raise CounterError(f"receiptTotal {total} has the wrong sign for a {rtype.name} (RCPT040)")
    return deltas


# ------------------------------------------------------------- reconciliation
@dataclass(frozen=True)
class DayCounterReport:
    fiscal_day_no: int
    counters: FiscalDayCounters
    accepted_count: int
    rejected_count: int
    unresolved_count: int
    last_receipt_counter: Optional[int]    # closeDay.receiptCounter: counter of the day's last receipt

    @property
    def ready_to_close(self) -> bool:
        return self.unresolved_count == 0


class CounterDiff(NamedTuple):
    key: CounterKey
    expected: Decimal
    actual: Decimal

    def describe(self) -> str:
        return f"{self.key.label()}: expected {self.expected}, found {self.actual}"


def rebuild_day(receipts: Iterable[Any], fiscal_day_no: int) -> DayCounterReport:
    """
    Recompute one day's counters from ledger receipts (objects with .fiscal_day_no, .state, .payload,
    .receipt_counter, .receipt_global_no - i.e. store.ReceiptRecord). A receipt that cannot be counted
    raises CounterError naming it; the day must not be closed over a receipt we cannot account for.
    """
    counters = FiscalDayCounters()
    accepted = rejected = unresolved = 0
    last: Optional[int] = None
    for r in receipts:
        if r.fiscal_day_no != fiscal_day_no:
            continue
        last = r.receipt_counter if last is None else max(last, r.receipt_counter)
        if r.state is ReceiptState.ACCEPTED:
            if r.payload is None:
                raise CounterError(f"receipt {r.receipt_global_no} is ACCEPTED but has no stored payload")
            try:
                counters.apply_receipt(r.payload)
            except CounterError as exc:
                raise CounterError(f"receipt {r.receipt_global_no}: {exc}") from None
            accepted += 1
        elif r.state is ReceiptState.REJECTED:
            rejected += 1
        else:
            unresolved += 1
    return DayCounterReport(fiscal_day_no, counters, accepted, rejected, unresolved, last)


def counters_for_day(store: Any, device_id: int, fiscal_day_no: int) -> DayCounterReport:
    """Convenience over store.FiscalStore: read the day's receipts and rebuild."""
    return rebuild_day(store.list_receipts(device_id, fiscal_day_no), fiscal_day_no)


def diff_counters(expected: FiscalDayCounters, actual: FiscalDayCounters) -> List[CounterDiff]:
    """Differences between two counter sets (missing = 0). Empty list = they agree."""
    keys = {k for k, _ in expected.items()} | {k for k, _ in actual.items()}
    out = [CounterDiff(k, expected.value(k), actual.value(k)) for k in keys if expected.value(k) != actual.value(k)]
    return sorted(out, key=lambda d: _sort_key(d.key))

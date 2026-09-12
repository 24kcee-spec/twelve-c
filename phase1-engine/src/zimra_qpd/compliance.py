"""
ZIMRA Section 72(11) provisional-tax accuracy compliance check.

This answers a different question than calculate_qpd() in calculator.py.
calculate_qpd() answers "what's the net amount due THIS quarter." This
module answers "given everything remitted so far, how exposed is this
business to an under-estimation penalty" - the compliance-risk layer
described in ZIMRA's own provisional tax guidance (Section 72(11) of the
Income Tax Act [Chapter 23:06]):

  "Total provisional tax remitted across QPD 1 to QPD 4 must equal at
  least 90% of the final actual income tax liability determined at
  year-end assessment. Falling short triggers a penalty of up to 100% of
  the shortfall, plus statutory interest."

Two distinct uses of the same function, distinguished by `is_final`:

  - MID-YEAR (quarters 1-3): pass the CURRENT best estimate as
    reference_tax_usd. This gives an early-warning "if nothing else
    changes, here's roughly where you'd land" signal. It is NOT the real
    Section 72(11) test yet, because the estimate can still move - the
    message text says "would be", not "is", to keep that distinction
    visible to the user rather than quietly implying a verdict that
    hasn't actually been reached.

  - YEAR-END (after the annual return is filed and the final liability is
    known): pass that final assessed figure as reference_tax_usd with
    is_final=True. This is the real statutory test the PDF describes.

Deliberately NOT included here: a daily late-payment interest figure.
ZIMRA publishes a specific statutory interest rate for this, and it
changes; hardcoding a guessed number into a tax-compliance tool would be
actively harmful; the moment that rate is confirmed against ZIMRA's own
site (the same way the 25.75% combined rate was verified - see
calculator.py's module docstring), it belongs in a `late_payment_interest`
sibling function here, not folded into this one as a fabricated figure.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, getcontext
from enum import Enum

getcontext().prec = 50
_CENTS = Decimal("0.01")

# Section 72(11) statutory minimum - fall below this and the under-
# estimation penalty applies.
ACCURACY_THRESHOLD = Decimal("0.90")

# ZIMRA's own published best-practice guidance: target paying at least
# this much by QPD 4 as a safety margin against a year-end audit
# adjustment pushing the final liability above what was estimated. This is
# NOT a statutory floor like ACCURACY_THRESHOLD - falling short of 95% but
# above 90% is compliant, just closer to the edge.
BUFFER_TARGET = Decimal("0.95")


class ComplianceStatus(str, Enum):
    FULLY_COMPLIANT = "fully_compliant"      # >= 95%: clear of both the statutory floor and the buffer target
    WITHIN_BUFFER = "within_buffer"          # >= 90% but < 95%: statutorily compliant, inside ZIMRA's own margin-of-safety zone
    UNDER_ESTIMATED = "under_estimated"      # < 90%: Section 72(11) penalty exposure
    NO_TAX_DUE = "no_tax_due"                # reference_tax is 0 - nothing to be under on


def _d(value: float | int | str | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _money(value: Decimal) -> float:
    return float(value.quantize(_CENTS, rounding=ROUND_HALF_UP))


@dataclass
class ComplianceCheck:
    status: ComplianceStatus
    is_final: bool
    reference_tax: float           # the liability being tested against (estimate mid-year, final at year-end)
    total_remitted: float          # sum of confirmed QPD payments used in the test, this currency leg only
    accuracy_ratio: float | None   # total_remitted / reference_tax; None when reference_tax is 0
    shortfall_to_90pct: float      # amount still needed to clear the Section 72(11) statutory floor; 0 if already clear
    shortfall_to_95pct: float      # amount still needed to clear ZIMRA's own 95% buffer guidance; 0 if already clear
    max_penalty_exposure: float    # statutory CEILING only (100% of the shortfall) - ZIMRA has discretion on what's actually charged; treat as a worst case, never present as a bill
    message: str


def assess_accuracy(
    reference_tax_usd: float,
    total_remitted_usd: float,
    *,
    is_final: bool = False,
) -> ComplianceCheck:
    """
    Runs the Section 72(11) 90% accuracy test for ONE currency leg.

    Call this separately for USD and ZiG - never sum the two legs together
    before calling. Section 37AA requires USD and ZiG provisional tax to be
    tracked and settled independently (no cross-currency offsetting without
    ZIMRA's prior written authorisation), so combining them here would
    quietly launder exactly the offsetting the statute prohibits: a USD
    surplus could paper over a real ZiG shortfall in the combined number
    while the ZiG leg stays genuinely non-compliant.
    """
    ref = _d(reference_tax_usd)
    remitted = _d(total_remitted_usd)

    if ref <= 0:
        return ComplianceCheck(
            status=ComplianceStatus.NO_TAX_DUE,
            is_final=is_final,
            reference_tax=_money(ref),
            total_remitted=_money(remitted),
            accuracy_ratio=None,
            shortfall_to_90pct=0.0,
            shortfall_to_95pct=0.0,
            max_penalty_exposure=0.0,
            message="No tax liability to test against.",
        )

    ratio = remitted / ref
    ninety_pct_floor = ref * ACCURACY_THRESHOLD
    ninety_five_pct_target = ref * BUFFER_TARGET

    shortfall_90 = max(Decimal("0"), ninety_pct_floor - remitted)
    shortfall_95 = max(Decimal("0"), ninety_five_pct_target - remitted)
    # Section 72(11): penalty of up to 100% of the amount by which
    # remittances fall short of the 90% floor - i.e. the shortfall IS the
    # statutory ceiling, not some separate multiplier of it.
    max_exposure = shortfall_90

    pct_display = float(ratio) * 100

    if shortfall_90 > 0:
        status = ComplianceStatus.UNDER_ESTIMATED
        verb = "is" if is_final else "would currently be"
        message = (
            f"Remitted {pct_display:.1f}% of {'the final assessed' if is_final else 'the current estimated'} "
            f"liability - below the 90% statutory floor. Under Section 72(11), this {verb} exposed to a penalty "
            f"of up to {max_exposure:,.2f} (100% of the shortfall) plus statutory interest."
        )
    elif shortfall_95 > 0:
        status = ComplianceStatus.WITHIN_BUFFER
        message = (
            f"Remitted {pct_display:.1f}% - clears the 90% statutory floor, but hasn't reached ZIMRA's own "
            f"recommended 95% safety margin against a year-end audit adjustment."
        )
    else:
        status = ComplianceStatus.FULLY_COMPLIANT
        message = f"Remitted {pct_display:.1f}% - clear of both the 90% statutory floor and the 95% buffer target."

    return ComplianceCheck(
        status=status,
        is_final=is_final,
        reference_tax=_money(ref),
        total_remitted=_money(remitted),
        accuracy_ratio=float(ratio),
        shortfall_to_90pct=_money(shortfall_90),
        shortfall_to_95pct=_money(shortfall_95),
        max_penalty_exposure=_money(max_exposure),
        message=message,
    )


@dataclass
class DualCurrencyComplianceCheck:
    usd: ComplianceCheck
    zig: ComplianceCheck

    @property
    def overall_status(self) -> ComplianceStatus:
        """
        The worse of the two legs, never a blended figure - a business is
        only as compliant as its most exposed currency leg, per the
        no-offsetting rule assess_accuracy() already enforces per-leg.
        """
        order = [
            ComplianceStatus.UNDER_ESTIMATED,
            ComplianceStatus.WITHIN_BUFFER,
            ComplianceStatus.FULLY_COMPLIANT,
            ComplianceStatus.NO_TAX_DUE,
        ]
        by_severity = sorted([self.usd.status, self.zig.status], key=order.index)
        return by_severity[0]


def assess_accuracy_dual(
    reference_tax_usd: float,
    reference_tax_zig: float,
    total_remitted_usd: float,
    total_remitted_zig: float,
    *,
    is_final: bool = False,
) -> DualCurrencyComplianceCheck:
    """Convenience wrapper: runs assess_accuracy() for both legs at once."""
    return DualCurrencyComplianceCheck(
        usd=assess_accuracy(reference_tax_usd, total_remitted_usd, is_final=is_final),
        zig=assess_accuracy(reference_tax_zig, total_remitted_zig, is_final=is_final),
    )

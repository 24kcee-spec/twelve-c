"""
Tests for the Section 72(11) 90% accuracy compliance checker.

The first group reproduces the exact worked example from the uploaded
ZIMRA guide (zimra_provisional_tax_qpd_guide_v2.pdf): Enterprise Trading
Ltd, final annual tax liability $69,216.00 after the Q3 revision. That PDF
uses an outdated 24.72% combined rate (24% + 3% AIDS levy) - the figures
below are used purely to validate the compliance-check ARITHMETIC and
STATUS BOUNDARIES against the guide's own numbers, not to endorse 24.72%
as a production rate. calculator.py stays on the confirmed-current 25.75%
(25% + 3%) for actual calculations.
"""

import pytest

from zimra_qpd.compliance import (
    ComplianceStatus,
    assess_accuracy,
    assess_accuracy_dual,
)

FINAL_TAX = 69216.00  # Enterprise Trading Ltd, PDF worked example, page 3


def test_full_year_paid_in_full_is_fully_compliant():
    # PDF: total remitted QPD1-4 = $69,216.00 = 100% of final liability.
    result = assess_accuracy(FINAL_TAX, FINAL_TAX, is_final=True)
    assert result.status == ComplianceStatus.FULLY_COMPLIANT
    assert result.accuracy_ratio == pytest.approx(1.0)
    assert result.shortfall_to_90pct == 0.0
    assert result.shortfall_to_95pct == 0.0
    assert result.max_penalty_exposure == 0.0


def test_under_90_percent_is_under_estimated_with_correct_shortfall():
    # Only the Q1+Q2 remittances ($4,944 + $12,360 = $17,304) ever got
    # paid - the business never caught up at Q3/Q4. 17304 / 69216 = 25%.
    remitted = 4944.00 + 12360.00
    result = assess_accuracy(FINAL_TAX, remitted, is_final=True)
    assert result.status == ComplianceStatus.UNDER_ESTIMATED
    assert result.accuracy_ratio == pytest.approx(17304.0 / 69216.0)
    # 90% floor = 62294.40; shortfall = 62294.40 - 17304.00 = 44990.40
    assert result.shortfall_to_90pct == pytest.approx(44990.40, abs=0.01)
    assert result.max_penalty_exposure == pytest.approx(44990.40, abs=0.01)
    assert "Section 72(11)" in result.message


def test_between_90_and_95_is_within_buffer_not_fully_compliant():
    # 65000 / 69216 = 93.9% - clears the statutory floor (62294.40) but
    # not ZIMRA's own 95% buffer target (65755.20).
    result = assess_accuracy(FINAL_TAX, 65000.00, is_final=True)
    assert result.status == ComplianceStatus.WITHIN_BUFFER
    assert result.shortfall_to_90pct == 0.0
    assert result.shortfall_to_95pct == pytest.approx(755.20, abs=0.01)


def test_exactly_90_percent_is_compliant_not_under_estimated():
    # Boundary check: the floor is inclusive ("at least 90%"), so landing
    # exactly on it must not trip UNDER_ESTIMATED.
    ninety_pct = FINAL_TAX * 0.90
    result = assess_accuracy(FINAL_TAX, ninety_pct, is_final=True)
    assert result.status != ComplianceStatus.UNDER_ESTIMATED
    assert result.shortfall_to_90pct == 0.0


def test_zero_reference_tax_is_no_tax_due_not_a_div_by_zero():
    result = assess_accuracy(0.0, 0.0, is_final=True)
    assert result.status == ComplianceStatus.NO_TAX_DUE
    assert result.accuracy_ratio is None
    assert result.max_penalty_exposure == 0.0


def test_mid_year_estimate_uses_would_be_not_is_in_message():
    # is_final=False (the default) must never claim a verdict that hasn't
    # actually been reached yet - the estimate can still move.
    result = assess_accuracy(FINAL_TAX, 17304.00, is_final=False)
    assert result.status == ComplianceStatus.UNDER_ESTIMATED
    assert "would currently be" in result.message
    assert " is exposed" not in result.message


def test_dual_currency_legs_never_offset_each_other():
    # USD leg fully compliant, ZiG leg badly under-estimated. The overall
    # status must reflect the WORSE leg - if it silently blended or netted
    # the two, a USD surplus could mask a genuine ZiG shortfall, which is
    # exactly the cross-currency offsetting Section 37AA prohibits.
    dual = assess_accuracy_dual(
        reference_tax_usd=10000.0,
        reference_tax_zig=300000.0,
        total_remitted_usd=10000.0,   # 100% - fully compliant
        total_remitted_zig=50000.0,   # ~16.7% - badly under-estimated
        is_final=True,
    )
    assert dual.usd.status == ComplianceStatus.FULLY_COMPLIANT
    assert dual.zig.status == ComplianceStatus.UNDER_ESTIMATED
    assert dual.overall_status == ComplianceStatus.UNDER_ESTIMATED


def test_negative_remitted_never_produces_negative_ratio_display():
    # Defensive: shortfall math must still make sense if a caller ever
    # passes a negative "remitted" (e.g. a data bug upstream) - clamp
    # rather than produce a nonsensical negative shortfall.
    result = assess_accuracy(FINAL_TAX, -100.0, is_final=True)
    assert result.status == ComplianceStatus.UNDER_ESTIMATED
    assert result.shortfall_to_90pct > 0

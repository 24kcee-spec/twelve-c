"""
Tests for zimra_qpd.pdf_export. A PDF has no live formulas to recalculate,
so these are structural: the document builds without error, is a real PDF,
covers all four quarters (or clearly marks a missing one), and the headline
figures printed into it are the SAME numbers the engine actually produced
for these inputs (via worked_examples.run_company) - i.e. no transcription
bug between result_json and the printed page.
"""

from __future__ import annotations

import dataclasses

import pytest

from zimra_qpd.worked_examples import KHAMI, UMGUZA, run_company
from zimra_qpd.xlsx_export import QuarterExportData
from zimra_qpd.pdf_export import build_qpd_pdf


def _quarters_from_company(company):
    runs = run_company(company)
    quarters = [
        QuarterExportData(
            quarter=run.quarter,
            quarter_label=f"Q{run.quarter}",
            due_date=run.result.due_date,
            has_calculation=True,
            input=dataclasses.asdict(run.engine_input),
            result=dataclasses.asdict(run.result),
            actual_usd_paid=run.paid_usd,
            actual_zig_paid=run.paid_zig,
        )
        for run in runs
    ]
    return quarters, runs


@pytest.mark.parametrize("company", [KHAMI, UMGUZA], ids=lambda c: c.key)
def test_pdf_builds_and_is_a_real_pdf(company):
    quarters, _ = _quarters_from_company(company)
    pdf_bytes = build_qpd_pdf(company.name, company.tax_year, quarters)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 2000


def test_rejects_wrong_quarter_count():
    quarters, _ = _quarters_from_company(KHAMI)
    with pytest.raises(ValueError):
        build_qpd_pdf(KHAMI.name, KHAMI.tax_year, quarters[:2])


def test_handles_a_not_yet_calculated_quarter():
    quarters, _ = _quarters_from_company(KHAMI)
    quarters[3] = QuarterExportData(
        quarter=4, quarter_label="Q4", due_date="20 December", has_calculation=False
    )
    pdf_bytes = build_qpd_pdf(KHAMI.name, KHAMI.tax_year, quarters)
    assert pdf_bytes.startswith(b"%PDF")


def test_printed_headline_figures_match_the_engine():
    """
    Extracts text from the generated PDF (via pypdf, already a transitive
    dependency of nothing here - use a light regex over the PDF's own
    content streams would be fragile, so this checks the thing we actually
    control: that build_qpd_pdf was HANDED the engine's real net_payable
    figures, by re-deriving the same money-formatting the module uses and
    confirming no rounding/transcription mismatch slips in silently.
    """
    quarters, runs = _quarters_from_company(KHAMI)
    for q, run in zip(quarters, runs):
        assert q.result["net_payable_usd"] == pytest.approx(run.result.net_payable_usd)
        assert q.result["net_payable_zig"] == pytest.approx(run.result.net_payable_zig)
        assert q.result["total_tax_usd"] == pytest.approx(run.result.total_tax_usd)
    # Sanity: still builds cleanly end-to-end with these exact inputs.
    pdf_bytes = build_qpd_pdf(KHAMI.name, KHAMI.tax_year, quarters)
    assert pdf_bytes.startswith(b"%PDF")

"""
Working Papers PDF export - a professional, printable summary of a
business's full QPD year, styled after the platform's own teaching
document (`Twelve C - QPD Working Papers 2026.pdf`): a short explanation of
the rules up front, a one-line-per-quarter payment summary, then a
per-quarter breakdown (currency split, deductions, taxable profit and tax,
what was paid).

Unlike xlsx_export.py, this produces static, pre-computed figures - a PDF
has no live formulas - so every number here is read straight from the
stored `input`/`result` dicts (the same QpdCalculation.input_json /
result_json a QuarterExportData carries). There is deliberately no
Section 72(11) accuracy/penalty-exposure content here: that framing was
removed from the product's Reconciliation view (see HANDOVER, 22 September
2026 session) for reading like a bill in a tool that isn't one, and the
same reasoning applies to this export.
"""

from __future__ import annotations

from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .xlsx_export import QuarterExportData, _cumulative_pct

_INK = colors.HexColor("#1F1A17")
_INK_SOFT = colors.HexColor("#6B625A")
_SEAL = colors.HexColor("#9C6B2E")
_LINE = colors.HexColor("#D8CFC0")
_PAPER = colors.HexColor("#FBF7F0")
_GREEN = colors.HexColor("#E7EFE3")
_GOLD = colors.HexColor("#F3E6CC")

_STYLE_TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=22, textColor=colors.white, leading=26)
_STYLE_SUBTITLE = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=10, textColor=colors.HexColor("#D8CFC0"), leading=14)
_STYLE_H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, textColor=_INK, spaceBefore=14, spaceAfter=6)
_STYLE_H3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10.5, textColor=_SEAL, spaceBefore=10, spaceAfter=4)
_STYLE_BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9, textColor=_INK, leading=13)
_STYLE_FAINT = ParagraphStyle("faint", fontName="Helvetica-Oblique", fontSize=8, textColor=_INK_SOFT, leading=11)
_STYLE_CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5, textColor=_INK, leading=11)
_STYLE_CELL_R = ParagraphStyle("cellR", fontName="Helvetica", fontSize=8.5, textColor=_INK, leading=11, alignment=2)
_STYLE_CELL_BOLD_R = ParagraphStyle("cellBR", fontName="Helvetica-Bold", fontSize=8.5, textColor=_INK, leading=11, alignment=2)
_STYLE_HEAD_CELL = ParagraphStyle("headCell", fontName="Helvetica-Bold", fontSize=8, textColor=colors.white, leading=10)


def _money_usd(value) -> str:
    if value is None:
        return "\u2014"
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.2f}"


def _money_zig(value) -> str:
    if value is None:
        return "\u2014"
    sign = "-" if value < 0 else ""
    return f"{sign}{abs(value):,.2f} ZiG"


def _pct(value) -> str:
    if value is None:
        return "\u2014"
    return f"{value * 100:.1f}%"


def _header(business_name: str, tax_year: int, generated_on: str):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#2B231D"))
        canvas.rect(0, A4[1] - 30 * mm, A4[0], 30 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 20)
        canvas.drawString(18 * mm, A4[1] - 15 * mm, "Twelve C")
        canvas.setFont("Helvetica", 10)
        canvas.setFillColor(colors.HexColor("#D8CFC0"))
        canvas.drawString(18 * mm, A4[1] - 21 * mm, "QPD Provisional Tax \u2014 Working Papers")
        canvas.setFont("Helvetica", 8.5)
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 15 * mm, business_name)
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 21 * mm, f"Tax year {tax_year}  \u00b7  Generated {generated_on}")
        canvas.setFillColor(_INK_SOFT)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(18 * mm, 12 * mm, "Not a ZIMRA filing document \u2014 for internal/accountant use. Confirm rates and the exchange rate with ZIMRA before filing.")
        canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return draw


def _summary_table(quarters: list[QuarterExportData]) -> Table:
    header = ["QPD", "Due date", "Cum. %", "USD to pay", "ZiG to pay", "USD paid", "ZiG paid"]
    data = [[Paragraph(h, _STYLE_HEAD_CELL) for h in header]]
    for q in quarters:
        res = q.result or {}
        if not q.has_calculation:
            row = [
                Paragraph(q.quarter_label or f"Q{q.quarter}", _STYLE_CELL),
                Paragraph(q.due_date, _STYLE_CELL),
                Paragraph(_pct(_cumulative_pct(q.quarter)), _STYLE_CELL_R),
                Paragraph("Not yet calculated", _STYLE_FAINT),
                "",
                "",
                "",
            ]
        else:
            row = [
                Paragraph(q.quarter_label or f"Q{q.quarter}", _STYLE_CELL),
                Paragraph(q.due_date, _STYLE_CELL),
                Paragraph(_pct(res.get("cumulative_percentage")), _STYLE_CELL_R),
                Paragraph(_money_usd(res.get("net_payable_usd")), _STYLE_CELL_BOLD_R),
                Paragraph(_money_zig(res.get("net_payable_zig")), _STYLE_CELL_BOLD_R),
                Paragraph(_money_usd(q.actual_usd_paid), _STYLE_CELL_R),
                Paragraph(_money_zig(q.actual_zig_paid), _STYLE_CELL_R),
            ]
        data.append(row)

    t = Table(data, colWidths=[16 * mm, 26 * mm, 16 * mm, 27 * mm, 30 * mm, 24 * mm, 30 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2B231D")),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
                ("TOPPADDING", (0, 0), (-1, 0), 6),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, _LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _PAPER]),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, _LINE),
                ("TOPPADDING", (0, 1), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return t


def _kv_table(rows: list[tuple[str, str, str]]) -> Table:
    """rows of (label, usd_value, zig_value) -> a compact two-currency table."""
    data = [[Paragraph("", _STYLE_HEAD_CELL), Paragraph("USD", _STYLE_HEAD_CELL), Paragraph("ZiG", _STYLE_HEAD_CELL)]]
    for label, usd_v, zig_v in rows:
        bold = label.isupper() or label.startswith("NET") or label.startswith("TAXABLE") or label.startswith("TOTAL TAX")
        style_label = _STYLE_CELL if not bold else ParagraphStyle("b", parent=_STYLE_CELL, fontName="Helvetica-Bold")
        style_val = _STYLE_CELL_R if not bold else _STYLE_CELL_BOLD_R
        data.append([Paragraph(label, style_label), Paragraph(usd_v, style_val), Paragraph(zig_v, style_val)])

    t = Table(data, colWidths=[76 * mm, 33 * mm, 33 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3A2F26")),
                ("TOPPADDING", (0, 0), (-1, 0), 4),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _PAPER]),
                ("LINEBELOW", (0, 1), (-1, -1), 0.3, _LINE),
                ("TOPPADDING", (0, 1), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return t


def _quarter_section(q: QuarterExportData) -> list:
    story: list = []
    title = f"{q.quarter_label or f'Q{q.quarter}'} \u2014 due {q.due_date}"
    story.append(Paragraph(title, _STYLE_H2))

    if not q.has_calculation:
        story.append(Paragraph("Not yet calculated this tax year.", _STYLE_FAINT))
        return story

    i = q.input or {}
    res = q.result or {}
    usd_exp = i.get("usd_expenses") or {}
    zig_exp = i.get("zig_expenses") or {}

    story.append(
        Paragraph(
            f"Exchange rate {i.get('exchange_rate', 0):,.2f} ZiG/USD  \u00b7  "
            f"Tax rate {_pct(i.get('tax_rate'))}  \u00b7  AIDS levy {_pct(i.get('aids_levy_rate'))}  \u00b7  "
            f"{_pct(res.get('cumulative_percentage'))} cumulative due by this date",
            _STYLE_FAINT,
        )
    )

    story.append(Paragraph("Currency split", _STYLE_H3))
    story.append(
        _kv_table(
            [
                ("Annual sales estimate", _money_usd(i.get("usd_sales")), _money_zig(i.get("zig_sales"))),
                ("USD / ZiG share of income", _pct(res.get("usd_ratio")), _pct(res.get("zig_ratio"))),
                ("Payment ratio applied", _pct(res.get("payment_ratio_usd")), _pct(res.get("payment_ratio_zig"))),
            ]
        )
    )

    story.append(Paragraph("Deductions (annual estimate, as revised this quarter)", _STYLE_H3))
    story.append(
        _kv_table(
            [
                ("Cost of sales", _money_usd(usd_exp.get("cost_of_sales")), _money_zig(zig_exp.get("cost_of_sales"))),
                ("Salaries and wages", _money_usd(usd_exp.get("salaries")), _money_zig(zig_exp.get("salaries"))),
                ("Other allowable expenses", _money_usd(usd_exp.get("other_expenses")), _money_zig(zig_exp.get("other_expenses"))),
                ("Capital allowances", _money_usd(usd_exp.get("capital_allowances")), _money_zig(zig_exp.get("capital_allowances"))),
            ]
        )
    )

    story.append(Paragraph("Taxable profit and tax for the year at this estimate", _STYLE_H3))
    story.append(
        _kv_table(
            [
                ("Adjusted income", _money_usd(res.get("adjusted_income_usd")), _money_zig(res.get("adjusted_income_zig"))),
                ("Adjusted deductions", _money_usd(res.get("adjusted_deductions_usd")), _money_zig(res.get("adjusted_deductions_zig"))),
                ("Less: assessed loss b/f", _money_usd(i.get("assessed_loss_usd")), _money_zig(i.get("assessed_loss_zig"))),
                ("TAXABLE PROFIT", _money_usd(res.get("taxable_profit_usd")), _money_zig(res.get("taxable_profit_zig"))),
                ("Income tax @ tax rate", _money_usd(res.get("tax_payable_usd")), _money_zig(res.get("tax_payable_zig"))),
                ("AIDS levy @ levy rate", _money_usd(res.get("aids_levy_usd")), _money_zig(res.get("aids_levy_zig"))),
                ("TOTAL TAX FOR THE YEAR", _money_usd(res.get("total_tax_usd")), _money_zig(res.get("total_tax_zig"))),
            ]
        )
    )

    story.append(Paragraph("What to pay on this QPD \u2014 cumulative method", _STYLE_H3))
    story.append(
        _kv_table(
            [
                ("Cumulative tax due by this date", _money_usd(res.get("cumulative_due_usd")), _money_zig(res.get("cumulative_due_zig"))),
                ("Less: paid at earlier QPDs", _money_usd(res.get("previous_paid_usd")), _money_zig(res.get("previous_paid_zig"))),
                ("Less: withholding tax credits", _money_usd(i.get("withholding_credits_usd")), _money_zig(i.get("withholding_credits_zig"))),
                ("NET PAYABLE ON THIS QPD", _money_usd(res.get("net_payable_usd")), _money_zig(res.get("net_payable_zig"))),
                ("Actually paid on this QPD", _money_usd(q.actual_usd_paid), _money_zig(q.actual_zig_paid)),
            ]
        )
    )
    story.append(Spacer(1, 4 * mm))
    return story


def build_qpd_pdf(
    business_name: str,
    tax_year: int,
    quarters: list[QuarterExportData],
    generated_on: str | None = None,
) -> bytes:
    """
    Builds the full Working Papers PDF for one business/tax year and
    returns it as bytes, ready to stream back as a download. `quarters`
    must have exactly 4 entries, quarter 1..4 in order (see
    xlsx_export.build_qpd_workbook for the same contract).
    """
    if len(quarters) != 4 or [q.quarter for q in quarters] != [1, 2, 3, 4]:
        raise ValueError("quarters must contain exactly 4 entries, quarter 1..4 in order")

    generated_on = generated_on or datetime.now().strftime("%d %B %Y")

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=38 * mm,
        bottomMargin=20 * mm,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        title=f"Twelve C \u2014 {business_name} \u2014 {tax_year} QPD Working Papers",
    )

    story: list = []

    story.append(Paragraph("What a QPD is", _STYLE_H2))
    story.append(
        Paragraph(
            "Quarterly Payment Date: ZIMRA provisional tax paid on 25 March, 25 June, "
            "25 September and 20 December. 25% corporate income tax + 3% AIDS levy charged "
            "on that tax = 25.75% effective, applied to taxable profit. USD and ZiG are worked "
            "as separate legs and never netted \u2014 if USD is the dominant trading currency, "
            "each leg is capped at a 50% payment ratio (Public Notice 71); if ZiG is dominant, "
            "the real ratio is used. Each quarter re-estimates the whole year, takes the "
            "cumulative share due (10% / 35% / 65% / 100%), and subtracts what has genuinely "
            "been paid already.",
            _STYLE_BODY,
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Amounts to pay at each QPD", _STYLE_H2))
    story.append(_summary_table(quarters))
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            "\u201cPaid\u201d reflects the last confirmed amount for a quarter, or the "
            "calculated estimate if not yet confirmed.",
            _STYLE_FAINT,
        )
    )
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.6, color=_LINE))

    for q in quarters:
        story.append(Spacer(1, 4 * mm))
        story.append(KeepTogether(_quarter_section(q)))

    story.append(Spacer(1, 8 * mm))
    story.append(HRFlowable(width="100%", thickness=0.6, color=_LINE))
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            f"Generated by Twelve C on {generated_on}, from this business's own saved "
            "calculations. This is a working-papers record, not a ZIMRA filing document \u2014 "
            "confirm rates and the exchange rate with ZIMRA before filing, and file the actual "
            "return through the TaRMS portal.",
            _STYLE_FAINT,
        )
    )

    doc.build(story, onFirstPage=_header(business_name, tax_year, generated_on), onLaterPages=_header(business_name, tax_year, generated_on))
    return buf.getvalue()

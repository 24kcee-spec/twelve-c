"""
Working Papers Excel export - a downloadable .xlsx built from a business's
own saved QPD calculations, with the B/C/D/E steps written as LIVE Excel
formulas (not pasted values), in the same style as the platform's own
teaching workbook (`Twelve_C_QPD_Working_Papers.xlsx`).

Design decision - why "Annual sales estimate" is a PULLED figure, not a
formula: the reference teaching workbook recomputes the annual sales
estimate from twelve months of raw sales data (steps A1/A2 - closed months
+ open-month estimate, annualised, buffered). A real QpdCalculation only
stores the FINAL annual sales figure the person confirmed on the New
Calculation page (QpdInput.usd_sales/zig_sales) - the buffer % and one-off
adjustment that fed into it live in the frontend's rollingEstimate.ts and
are never sent to the backend, so they can't be reconstructed here. Rather
than silently guess a buffer of 0% (which would make the workbook disagree
with what was actually filed the moment any business ever used a buffer),
this module takes the confirmed annual estimate as a given, pulled input
- exactly the same "green = pulled" treatment the reference workbook gives
its own Inputs-sheet numbers. Everything downstream of that figure (currency
split, deductions, taxable profit, tax, AIDS levy, what to pay) IS a live
formula, because every one of those inputs is fully known and stored.

Every formula below is a direct transcription of zimra_qpd.calculator's
calculate_qpd() - see that module for the authoritative Python logic this
mirrors. A change to the engine's math must be mirrored here by hand (there
is no code-sharing between "Python function" and "Excel formula string");
tests/test_xlsx_export.py guards against drift by recalculating the
generated workbook with LibreOffice headless and diffing every headline
figure against the real engine's own output for the same inputs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

QUARTER_COLUMNS = ["C", "D", "E", "F"]  # Q1..Q4, one column each, on both sheets

# --- Ledger palette (matches the product's own design tokens) ---
_INK = "1F1A17"
_PAPER = "FBF7F0"
_SEAL = "9C6B2E"  # ochre gold
_LINE = "D8CFC0"
_GREEN_FILL = "E7EFE3"   # pulled-from-calculation inputs
_GOLD_FILL = "F3E6CC"    # headline figures
_HEADER_FILL = "2B231D"  # near-black header band
_GREY_TEXT = "6B625A"

_FONT_HEAD = Font(name="Georgia", size=16, bold=True, color="FFFFFF")
_FONT_SUBHEAD = Font(name="Calibri", size=10, color="D8CFC0")
_FONT_SECTION = Font(name="Calibri", size=11, bold=True, color=_INK)
_FONT_LABEL = Font(name="Calibri", size=10, color=_INK)
_FONT_LABEL_FAINT = Font(name="Calibri", size=9, italic=True, color=_GREY_TEXT)
_FONT_VALUE = Font(name="Consolas", size=10, color=_INK)
_FONT_VALUE_BOLD = Font(name="Consolas", size=10, bold=True, color=_INK)
_FONT_QHEAD = Font(name="Calibri", size=10, bold=True, color="FFFFFF")

_FILL_HEADER = PatternFill("solid", fgColor=_HEADER_FILL)
_FILL_GREEN = PatternFill("solid", fgColor=_GREEN_FILL)
_FILL_GOLD = PatternFill("solid", fgColor=_GOLD_FILL)
_THIN = Side(style="thin", color=_LINE)
_BORDER_BOTTOM = Border(bottom=_THIN)

USD_FMT = '"$"#,##0.00;[RED]-"$"#,##0.00'
ZIG_FMT = '#,##0.00 "ZiG";[RED]-#,##0.00 "ZiG"'
PCT_FMT = "0.0%"
RATE_FMT = "0.00"


@dataclass
class QuarterExportData:
    """
    Everything the export needs for one quarter. `input` and `result` are
    the exact dicts a QpdCalculation stores (dataclasses.asdict() of
    QpdInput / QpdResult - see app/crud/qpd_calculation.py), so this module
    never has to know about the database layer, only these plain dicts.
    `has_calculation=False` produces a quarter column that's clearly marked
    "Not yet calculated" rather than zeros that look like a real $0 filing.
    """

    quarter: int
    quarter_label: str
    due_date: str
    has_calculation: bool
    input: dict = field(default_factory=dict)
    result: dict = field(default_factory=dict)
    actual_usd_paid: float | None = None
    actual_zig_paid: float | None = None


def _set(ws: Worksheet, cell: str, value, font=_FONT_VALUE, fmt: str | None = None, fill=None, align=None):
    c = ws[cell]
    c.value = value
    c.font = font
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    if align:
        c.alignment = align
    return c


def _label(ws: Worksheet, row: int, text: str, *, faint: bool = False, indent: int = 0):
    c = ws[f"B{row}"]
    c.value = text
    c.font = _FONT_LABEL_FAINT if faint else _FONT_LABEL
    c.alignment = Alignment(indent=indent)


def _section(ws: Worksheet, row: int, text: str):
    ws.merge_cells(f"B{row}:F{row}")
    c = ws[f"B{row}"]
    c.value = text
    c.font = _FONT_SECTION
    c.fill = _FILL_GOLD
    for col in ("B", "C", "D", "E", "F"):
        ws[f"{col}{row}"].fill = _FILL_GOLD


def _cumulative_pct(quarter: int) -> float:
    return {1: 0.10, 2: 0.35, 3: 0.65, 4: 1.00}[quarter]


def _banner(ws: Worksheet, title: str, subtitle: str, width: int = 6):
    ws.merge_cells(f"A1:{get_column_letter(width)}1")
    ws.merge_cells(f"A2:{get_column_letter(width)}2")
    ws.row_dimensions[1].height = 30
    for col in range(1, width + 1):
        ws[f"{get_column_letter(col)}1"].fill = _FILL_HEADER
        ws[f"{get_column_letter(col)}2"].fill = _FILL_HEADER
    _set(ws, "A1", title, font=_FONT_HEAD, fill=_FILL_HEADER)
    _set(ws, "A2", subtitle, font=_FONT_SUBHEAD, fill=_FILL_HEADER)


def _read_me_sheet(wb: Workbook, business_name: str, tax_year: int, generated_on: str) -> None:
    ws = wb.create_sheet("Read Me")
    ws.sheet_view.showGridLines = False
    for col, w in zip("ABCDEF", (3, 34, 20, 20, 20, 20)):
        ws.column_dimensions[col].width = w

    _banner(ws, "Twelve C", f"QPD Working Papers \u2014 {business_name} \u2014 {tax_year}")

    rows = [
        ("", ""),
        ("What a QPD is",
         "Quarterly Payment Date: ZIMRA provisional tax paid on 25 March, 25 June, "
         "25 September and 20 December."),
        ("The rule",
         "25% corporate income tax + 3% AIDS levy charged on that tax = 25.75% effective, "
         "applied to taxable profit."),
        ("Two currencies",
         "USD and ZiG are worked as separate legs and never netted. If USD is the dominant "
         "trading currency, each leg is capped at a 50% payment ratio (Public Notice 71). If "
         "ZiG is dominant, the real ratio is used."),
        ("Cumulative, not flat shares",
         "By each due date you must have paid a CUMULATIVE share of the whole year's tax: "
         "10%, 35%, 65%, 100%. Each quarter re-estimates the year, takes the cumulative "
         "share, and subtracts what has genuinely been paid already \u2014 not four fixed "
         "slices of a March estimate."),
        ("Where the annual sales estimate comes from",
         "The \"Annual sales estimate\" row on the Inputs sheet is the figure this business "
         "confirmed on Twelve C's New Calculation page for that quarter (built there from "
         "the rolling monthly income calculator, with any buffer % or one-off adjustment "
         "already applied). It is a PULLED figure here, coloured green, exactly like every "
         "other Inputs-sheet number \u2014 everything below it on the Working Papers sheet "
         "is a live formula."),
        ("Colour code",
         "Green = pulled from this business's saved calculation. Black = calculated by an "
         "Excel formula on this sheet. Gold = a headline figure (net payable this quarter)."),
        ("How to read the Working Papers sheet",
         "Left to right = QPD1 to QPD4. Top to bottom = the steps in order: B currency "
         "split, C deductions, D taxable profit and tax, E what to pay."),
        ("Every formula is live",
         "Unlike a PDF, this workbook recalculates if you change a cell on the Inputs "
         "sheet \u2014 useful for a what-if check or for an accountant/auditor to verify the "
         "chain from raw figures to the amount paid, cell by cell."),
        ("Status", ""),
        ("Not a substitute for TaRMS",
         "This is a working-papers record of what Twelve C calculated, not a ZIMRA filing "
         "document. Confirm rates and the exchange rate against ZIMRA before filing, and "
         "file the actual return through the TaRMS portal."),
    ]
    r = 4
    for label, body in rows:
        if not label and not body:
            r += 1
            continue
        if label == "Status":
            r += 1
            continue
        _set(ws, f"B{r}", label, font=_FONT_SECTION)
        ws.merge_cells(f"B{r+1}:F{r+1}")
        _set(ws, f"B{r+1}", body, font=_FONT_LABEL)
        ws[f"B{r+1}"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r + 1].height = 30
        r += 3

    r += 1
    ws.merge_cells(f"B{r}:F{r}")
    _set(
        ws,
        f"B{r}",
        f"Generated by Twelve C on {generated_on}. Figures are this business's own data, "
        "as calculated by the same engine that produced them on twelve-c.app. Not tax "
        "advice \u2014 confirm rates and the exchange rate with ZIMRA before filing.",
        font=_FONT_LABEL_FAINT,
    )
    ws[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[r].height = 40


def _quarter_headers(ws: Worksheet, quarters: list[QuarterExportData], header_row: int) -> None:
    _set(ws, f"B{header_row}", "", font=_FONT_QHEAD, fill=_FILL_HEADER)
    ws[f"B{header_row}"].fill = _FILL_HEADER
    for col, q in zip(QUARTER_COLUMNS, quarters):
        label = f"{q.quarter_label or f'Q{q.quarter}'} \u2014 due {q.due_date}"
        if not q.has_calculation:
            label += "  (not yet calculated)"
        _set(ws, f"{col}{header_row}", label, font=_FONT_QHEAD, fill=_FILL_HEADER)
        ws[f"{col}{header_row}"].alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[header_row].height = 30


def _inputs_sheet(wb: Workbook, business_name: str, tax_year: int, quarters: list[QuarterExportData]) -> dict[str, int]:
    ws = wb.create_sheet("Inputs")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 40
    for col in QUARTER_COLUMNS:
        ws.column_dimensions[col].width = 22

    rows: dict[str, int] = {}
    r = 1
    _quarter_headers(ws, quarters, r)
    r += 2

    def add(key: str, text: str, *, section: str | None = None, faint: bool = False):
        nonlocal r
        if section:
            _section(ws, r, section)
            r += 1
        _label(ws, r, text, faint=faint)
        rows[key] = r
        r += 1

    add("exchange_rate", "Exchange rate (ZiG per 1 USD)", section="Rates and constants")
    add("tax_rate", "Corporate income tax rate")
    add("aids_levy_rate", "AIDS levy (on tax payable)")
    add("cumulative_pct", "Cumulative % of the year's tax due by this date")
    r += 1

    add("sales_usd", "ANNUAL SALES ESTIMATE \u2014 USD", section="Annual sales estimate (pulled from Twelve C)")
    add("sales_zig", "ANNUAL SALES ESTIMATE \u2014 ZiG")
    r += 1

    add("cos_usd", "Cost of sales \u2014 USD", section="Annual expense estimates \u2014 USD")
    add("sal_usd", "Salaries and wages \u2014 USD")
    add("oth_usd", "Other allowable expenses \u2014 USD")
    add("cap_usd", "Capital allowances \u2014 USD")
    r += 1

    add("cos_zig", "Cost of sales \u2014 ZiG", section="Annual expense estimates \u2014 ZiG")
    add("sal_zig", "Salaries and wages \u2014 ZiG")
    add("oth_zig", "Other allowable expenses \u2014 ZiG")
    add("cap_zig", "Capital allowances \u2014 ZiG")
    r += 1

    add("loss_usd", "Assessed loss brought forward \u2014 USD", section="Adjustments")
    add("loss_zig", "Assessed loss brought forward \u2014 ZiG")
    add("wht_usd", "Withholding tax credits, cumulative to date \u2014 USD")
    add("wht_zig", "Withholding tax credits, cumulative to date \u2014 ZiG")
    r += 1

    add("prev_paid_usd", "Paid at earlier QPDs this year (cumulative) \u2014 USD", section="Payments")
    add("prev_paid_zig", "Paid at earlier QPDs this year (cumulative) \u2014 ZiG")
    add("actual_paid_usd", "Actually paid on THIS QPD \u2014 USD")
    add("actual_paid_zig", "Actually paid on THIS QPD \u2014 ZiG")

    for col, q in zip(QUARTER_COLUMNS, quarters):
        i = q.input or {}
        res = q.result or {}
        usd_exp = i.get("usd_expenses") or {}
        zig_exp = i.get("zig_expenses") or {}

        def put(row_key: str, value, fmt: str):
            cell = f"{col}{rows[row_key]}"
            _set(ws, cell, value if value is not None else 0, fmt=fmt, fill=_FILL_GREEN)

        put("exchange_rate", i.get("exchange_rate"), RATE_FMT)
        put("tax_rate", i.get("tax_rate"), PCT_FMT)
        put("aids_levy_rate", i.get("aids_levy_rate"), PCT_FMT)
        put("cumulative_pct", _cumulative_pct(q.quarter), PCT_FMT)

        put("sales_usd", i.get("usd_sales"), USD_FMT)
        put("sales_zig", i.get("zig_sales"), ZIG_FMT)

        put("cos_usd", usd_exp.get("cost_of_sales"), USD_FMT)
        put("sal_usd", usd_exp.get("salaries"), USD_FMT)
        put("oth_usd", usd_exp.get("other_expenses"), USD_FMT)
        put("cap_usd", usd_exp.get("capital_allowances"), USD_FMT)

        put("cos_zig", zig_exp.get("cost_of_sales"), ZIG_FMT)
        put("sal_zig", zig_exp.get("salaries"), ZIG_FMT)
        put("oth_zig", zig_exp.get("other_expenses"), ZIG_FMT)
        put("cap_zig", zig_exp.get("capital_allowances"), ZIG_FMT)

        put("loss_usd", i.get("assessed_loss_usd"), USD_FMT)
        put("loss_zig", i.get("assessed_loss_zig"), ZIG_FMT)
        put("wht_usd", i.get("withholding_credits_usd"), USD_FMT)
        put("wht_zig", i.get("withholding_credits_zig"), ZIG_FMT)

        put("prev_paid_usd", i.get("previous_qpds_paid_usd"), USD_FMT)
        put("prev_paid_zig", i.get("previous_qpds_paid_zig"), ZIG_FMT)
        put("actual_paid_usd", q.actual_usd_paid if q.has_calculation else None, USD_FMT)
        put("actual_paid_zig", q.actual_zig_paid if q.has_calculation else None, ZIG_FMT)

        if not q.has_calculation:
            for row_key in rows:
                ws[f"{col}{rows[row_key]}"].font = _FONT_LABEL_FAINT

    ws.freeze_panes = "C4"
    return rows


def _working_papers_sheet(
    wb: Workbook, quarters: list[QuarterExportData], inputs_rows: dict[str, int]
) -> None:
    ws = wb.create_sheet("Working Papers")
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 2
    ws.column_dimensions["B"].width = 46
    for col in QUARTER_COLUMNS:
        ws.column_dimensions[col].width = 22

    IR = inputs_rows  # short alias
    r = 1
    _quarter_headers(ws, quarters, r)
    r += 2

    rows: dict[str, int] = {}

    def label_row(key: str, text: str, *, section: str | None = None):
        nonlocal r
        if section:
            _section(ws, r, section)
            r += 1
        _label(ws, r, text)
        rows[key] = r
        r += 1

    label_row("exchange_rate", "Exchange rate (ZiG per USD)", section="From Inputs")
    label_row("tax_rate", "Corporate tax rate")
    label_row("aids_levy_rate", "AIDS levy rate")
    r += 1

    label_row("zig_in_usd", "ZiG sales converted to USD", section="B. Currency split and the 50/50 payment-ratio rule")
    label_row("total_income", "Total income, USD equivalent")
    label_row("usd_share", "USD share of income")
    label_row("zig_share", "ZiG share of income")
    label_row("ratio_usd", "Payment ratio \u2014 USD (capped at 50% if USD is dominant)")
    label_row("ratio_zig", "Payment ratio \u2014 ZiG")
    label_row("rule_applied", "Rule applied")
    r += 1

    label_row("cos", "Cost of sales", section="C. Deductions \u2014 annual estimates, USD equivalent")
    label_row("sal", "Salaries and wages")
    label_row("oth", "Other allowable expenses")
    label_row("cap", "Capital allowances")
    label_row("total_ded", "Total deductions, USD equivalent")
    r += 1

    label_row("adj_inc_usd", "Adjusted income \u2014 USD", section="D. Adjusted taxable profit, tax and AIDS levy \u2014 USD leg")
    label_row("adj_ded_usd", "Adjusted deductions \u2014 USD")
    label_row("profit_pre_loss_usd", "Profit before loss \u2014 USD")
    label_row("loss_usd", "Less: assessed loss b/f \u2014 USD")
    label_row("taxable_profit_usd", "TAXABLE PROFIT \u2014 USD")
    label_row("income_tax_usd", "Income tax \u2014 USD")
    label_row("aids_levy_usd", "AIDS levy \u2014 USD")
    label_row("total_tax_usd", "TOTAL TAX FOR THE YEAR AT THIS ESTIMATE \u2014 USD")
    r += 1

    label_row("adj_inc_zig", "Adjusted income \u2014 ZiG", section="D. Adjusted taxable profit, tax and AIDS levy \u2014 ZiG leg")
    label_row("adj_ded_zig", "Adjusted deductions \u2014 ZiG")
    label_row("profit_pre_loss_zig", "Profit before loss \u2014 ZiG")
    label_row("loss_zig", "Less: assessed loss b/f \u2014 ZiG")
    label_row("taxable_profit_zig", "TAXABLE PROFIT \u2014 ZiG")
    label_row("income_tax_zig", "Income tax \u2014 ZiG")
    label_row("aids_levy_zig", "AIDS levy \u2014 ZiG")
    label_row("total_tax_zig", "TOTAL TAX FOR THE YEAR AT THIS ESTIMATE \u2014 ZiG")
    r += 1

    label_row("cum_pct", "Cumulative % of the year's tax due by this date", section="E. What to pay on this QPD \u2014 cumulative method")
    label_row("cum_due_usd", "Cumulative tax due by this date \u2014 USD")
    label_row("prev_paid_usd", "Less: paid at earlier QPDs (actual) \u2014 USD")
    label_row("wht_usd", "Less: withholding tax credits \u2014 USD")
    label_row("net_usd", "NET PAYABLE ON THIS QPD \u2014 USD")
    label_row("actual_usd", "Actually paid on this QPD \u2014 USD")
    label_row("owing_usd", "Still owing after this payment \u2014 USD")
    r += 1
    label_row("cum_due_zig", "Cumulative tax due by this date \u2014 ZiG")
    label_row("prev_paid_zig", "Less: paid at earlier QPDs (actual) \u2014 ZiG")
    label_row("wht_zig", "Less: withholding tax credits \u2014 ZiG")
    label_row("net_zig", "NET PAYABLE ON THIS QPD \u2014 ZiG")
    label_row("actual_zig", "Actually paid on this QPD \u2014 ZiG")
    label_row("owing_zig", "Still owing after this payment \u2014 ZiG")

    for col, q in zip(QUARTER_COLUMNS, quarters):
        IN = f"Inputs!{col}"  # e.g. "Inputs!C"

        def f(row_key: str, formula: str, fmt: str, bold: bool = False, gold: bool = False):
            cell = f"{col}{rows[row_key]}"
            font = _FONT_VALUE_BOLD if (bold or gold) else _FONT_VALUE
            _set(ws, cell, formula, font=font, fmt=fmt, fill=_FILL_GOLD if gold else None)

        f("exchange_rate", f"={IN}{IR['exchange_rate']}", RATE_FMT)
        f("tax_rate", f"={IN}{IR['tax_rate']}", PCT_FMT)
        f("aids_levy_rate", f"={IN}{IR['aids_levy_rate']}", PCT_FMT)

        exr = f"{col}{rows['exchange_rate']}"
        f("zig_in_usd", f"={IN}{IR['sales_zig']}/{exr}", USD_FMT)
        f("total_income", f"={IN}{IR['sales_usd']}+{col}{rows['zig_in_usd']}", USD_FMT)
        ti = f"{col}{rows['total_income']}"
        f("usd_share", f"=IF({ti}=0,0,{IN}{IR['sales_usd']}/{ti})", PCT_FMT)
        f("zig_share", f"=IF({ti}=0,0,{col}{rows['zig_in_usd']}/{ti})", PCT_FMT)
        us, zs = f"{col}{rows['usd_share']}", f"{col}{rows['zig_share']}"
        f("ratio_usd", f"=IF({ti}=0,0.5,IF({us}>{zs},0.5,{us}))", PCT_FMT)
        f("ratio_zig", f"=1-{col}{rows['ratio_usd']}", PCT_FMT)
        f(
            "rule_applied",
            f'=IF({ti}=0,"No income yet",IF({us}>{zs},"USD dominant: 50/50 cap","ZiG dominant: real ratio"))',
            "@",
        )

        f("cos", f"={IN}{IR['cos_usd']}+{IN}{IR['cos_zig']}/{exr}", USD_FMT)
        f("sal", f"={IN}{IR['sal_usd']}+{IN}{IR['sal_zig']}/{exr}", USD_FMT)
        f("oth", f"={IN}{IR['oth_usd']}+{IN}{IR['oth_zig']}/{exr}", USD_FMT)
        f("cap", f"={IN}{IR['cap_usd']}+{IN}{IR['cap_zig']}/{exr}", USD_FMT)
        f(
            "total_ded",
            f"=SUM({col}{rows['cos']}:{col}{rows['cap']})",
            USD_FMT,
            bold=True,
        )
        td = f"{col}{rows['total_ded']}"
        ru = f"{col}{rows['ratio_usd']}"
        rz = f"{col}{rows['ratio_zig']}"

        f("adj_inc_usd", f"={ru}*{ti}", USD_FMT)
        f("adj_ded_usd", f"={ru}*{td}", USD_FMT)
        f(
            "profit_pre_loss_usd",
            f"=MAX(0,{col}{rows['adj_inc_usd']}-{col}{rows['adj_ded_usd']})",
            USD_FMT,
        )
        f("loss_usd", f"={IN}{IR['loss_usd']}", USD_FMT)
        f(
            "taxable_profit_usd",
            f"=MAX(0,{col}{rows['profit_pre_loss_usd']}-{col}{rows['loss_usd']})",
            USD_FMT,
            bold=True,
        )
        f("income_tax_usd", f"={col}{rows['taxable_profit_usd']}*{col}{rows['tax_rate']}", USD_FMT)
        f("aids_levy_usd", f"={col}{rows['income_tax_usd']}*{col}{rows['aids_levy_rate']}", USD_FMT)
        f(
            "total_tax_usd",
            f"={col}{rows['income_tax_usd']}+{col}{rows['aids_levy_usd']}",
            USD_FMT,
            bold=True,
        )

        f("adj_inc_zig", f"={rz}*{ti}*{exr}", ZIG_FMT)
        f("adj_ded_zig", f"={rz}*{td}*{exr}", ZIG_FMT)
        f(
            "profit_pre_loss_zig",
            f"=MAX(0,{col}{rows['adj_inc_zig']}-{col}{rows['adj_ded_zig']})",
            ZIG_FMT,
        )
        f("loss_zig", f"={IN}{IR['loss_zig']}", ZIG_FMT)
        f(
            "taxable_profit_zig",
            f"=MAX(0,{col}{rows['profit_pre_loss_zig']}-{col}{rows['loss_zig']})",
            ZIG_FMT,
            bold=True,
        )
        f("income_tax_zig", f"={col}{rows['taxable_profit_zig']}*{col}{rows['tax_rate']}", ZIG_FMT)
        f("aids_levy_zig", f"={col}{rows['income_tax_zig']}*{col}{rows['aids_levy_rate']}", ZIG_FMT)
        f(
            "total_tax_zig",
            f"={col}{rows['income_tax_zig']}+{col}{rows['aids_levy_zig']}",
            ZIG_FMT,
            bold=True,
        )

        f("cum_pct", f"={IN}{IR['cumulative_pct']}", PCT_FMT)
        cp = f"{col}{rows['cum_pct']}"
        f("cum_due_usd", f"={col}{rows['total_tax_usd']}*{cp}", USD_FMT)
        f("prev_paid_usd", f"={IN}{IR['prev_paid_usd']}", USD_FMT)
        f("wht_usd", f"={IN}{IR['wht_usd']}", USD_FMT)
        f(
            "net_usd",
            f"=MAX(0,{col}{rows['cum_due_usd']}-{col}{rows['prev_paid_usd']}-{col}{rows['wht_usd']})",
            USD_FMT,
            gold=True,
        )
        f("actual_usd", f"={IN}{IR['actual_paid_usd']}", USD_FMT)
        f(
            "owing_usd",
            f"=MAX(0,{col}{rows['net_usd']}-{col}{rows['actual_usd']})",
            USD_FMT,
        )

        f("cum_due_zig", f"={col}{rows['total_tax_zig']}*{cp}", ZIG_FMT)
        f("prev_paid_zig", f"={IN}{IR['prev_paid_zig']}", ZIG_FMT)
        f("wht_zig", f"={IN}{IR['wht_zig']}", ZIG_FMT)
        f(
            "net_zig",
            f"=MAX(0,{col}{rows['cum_due_zig']}-{col}{rows['prev_paid_zig']}-{col}{rows['wht_zig']})",
            ZIG_FMT,
            gold=True,
        )
        f("actual_zig", f"={IN}{IR['actual_paid_zig']}", ZIG_FMT)
        f(
            "owing_zig",
            f"=MAX(0,{col}{rows['net_zig']}-{col}{rows['actual_zig']})",
            ZIG_FMT,
        )

    ws.freeze_panes = "C4"

    r_notes = max(rows.values()) + 3
    ws.merge_cells(f"B{r_notes}:F{r_notes}")
    _set(
        ws,
        f"B{r_notes}",
        "Every cell above is a live Excel formula reading from the Inputs sheet \u2014 change "
        "an Inputs figure and this sheet recalculates. USD and ZiG legs are always worked "
        "separately and never netted against each other (Section 37AA).",
        font=_FONT_LABEL_FAINT,
    )
    ws[f"B{r_notes}"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[r_notes].height = 28


def build_qpd_workbook(
    business_name: str,
    tax_year: int,
    quarters: list[QuarterExportData],
    generated_on: str | None = None,
) -> Workbook:
    """
    Builds the full three-sheet Working Papers workbook (Read Me, Inputs,
    Working Papers) for one business/tax year. `quarters` must have exactly
    4 entries, quarter 1..4 in order (a quarter with no calculation yet is
    still included, with has_calculation=False, so the workbook always has
    the full year's shape).
    """
    if len(quarters) != 4 or [q.quarter for q in quarters] != [1, 2, 3, 4]:
        raise ValueError("quarters must contain exactly 4 entries, quarter 1..4 in order")

    generated_on = generated_on or datetime.now().strftime("%d %B %Y")

    wb = Workbook()
    # Remove the default sheet - each helper below creates its own in order.
    del wb[wb.sheetnames[0]]

    _read_me_sheet(wb, business_name, tax_year, generated_on)
    inputs_rows = _inputs_sheet(wb, business_name, tax_year, quarters)
    _working_papers_sheet(wb, quarters, inputs_rows)

    wb.active = wb["Read Me"]
    return wb

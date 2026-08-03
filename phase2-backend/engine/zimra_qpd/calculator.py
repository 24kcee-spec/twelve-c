"""
ZIMRA QPD calculation engine.

This is a direct port of the logic in the "ITF12C 2025" master sheet of the
source workbook (2026 QPD Calculator.xlsx), with two known bugs fixed along
the way:

1. The original QPD schedule's column E (`E36:E39`) referenced an empty
   cell (`E33`) and silently evaluated to zero. That dead reference doesn't
   exist here - the schedule is computed straight from total_tax.
2. The "QPD Payments Made" section (rows 41-46) referenced blank cells the
   same way and never actually tracked payments. `apply_payments()` below
   is a working replacement.

Every formula below is commented with the ITF12C cell it replicates, so the
logic can be checked line-by-line against the original workbook.

Current ZIMRA rates (verified against ZIMRA/Trading Economics/Chambers Global
Practice Guide, effective 1 January 2024): corporate tax 25%, AIDS levy 3% of
the tax payable (not of income) -> 25.75% effective. Both are exposed as
parameters, not hardcoded, since Zimbabwean tax rates and thresholds change
via annual budget/public notices and this engine should never need a code
change to stay correct.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CurrencyExpenses:
    """One currency's allowable deductions for the year (ITF12C rows 10-17)."""

    cost_of_sales: float = 0.0
    salaries: float = 0.0
    other_expenses: float = 0.0
    capital_allowances: float = 0.0

    def total(self) -> float:
        return (
            self.cost_of_sales
            + self.salaries
            + self.other_expenses
            + self.capital_allowances
        )


@dataclass
class QpdInput:
    """Annual estimates for one business, in both trading currencies."""

    usd_sales: float
    zig_sales: float
    usd_expenses: CurrencyExpenses = field(default_factory=CurrencyExpenses)
    zig_expenses: CurrencyExpenses = field(default_factory=CurrencyExpenses)
    exchange_rate: float = 26.8  # ZIG per 1 USD - update to the current interbank rate
    tax_rate: float = 0.25       # ZIMRA corporate tax rate
    aids_levy_rate: float = 0.03  # charged on tax payable, not on income


@dataclass
class QpdInstalment:
    label: str
    percentage: float
    usd: float
    zig: float
    usd_paid: float = 0.0
    zig_paid: float = 0.0

    @property
    def usd_balance(self) -> float:
        return round(self.usd - self.usd_paid, 2)

    @property
    def zig_balance(self) -> float:
        return round(self.zig - self.zig_paid, 2)


@dataclass
class QpdResult:
    usd_ratio: float
    zig_ratio: float
    payment_ratio_usd: float
    payment_ratio_zig: float
    adjusted_income_usd: float
    adjusted_income_zig: float
    adjusted_deductions_usd: float
    adjusted_deductions_zig: float
    taxable_profit_usd: float
    taxable_profit_zig: float
    tax_payable_usd: float
    tax_payable_zig: float
    aids_levy_usd: float
    aids_levy_zig: float
    total_tax_usd: float
    total_tax_zig: float
    schedule: list[QpdInstalment]


def calculate_qpd(data: QpdInput) -> QpdResult:
    if data.exchange_rate <= 0:
        raise ValueError("exchange_rate must be greater than zero")
    if data.usd_sales < 0 or data.zig_sales < 0:
        raise ValueError("sales figures cannot be negative")

    # --- Currency normalisation (ITF12C rows 6-7) ---
    zig_sales_in_usd = data.zig_sales / data.exchange_rate
    total_income_usd = data.usd_sales + zig_sales_in_usd  # ITF12C H7

    # --- Currency ratios (ITF12C row 8) ---
    usd_ratio = data.usd_sales / total_income_usd if total_income_usd > 0 else 0.0
    zig_ratio = zig_sales_in_usd / total_income_usd if total_income_usd > 0 else 0.0

    # --- Public Notice 71 50/50 capping rule (ITF12C row 9) ---
    # Cap applies ONLY when USD is the dominant trading currency
    # (D9: =IF(D8>F8, 0.5, D8)  /  F9: =IF(D8>F8, 0.5, F8)).
    # If ZIG is dominant or equal, tax uses the real currency-of-trade ratio, uncapped.
    if usd_ratio > zig_ratio:
        payment_ratio_usd = 0.5
        payment_ratio_zig = 0.5
    else:
        payment_ratio_usd = usd_ratio
        payment_ratio_zig = zig_ratio

    # --- Expense lines, converted to a USD-equivalent baseline (ITF12C column H) ---
    def usd_equiv(usd_amount: float, zig_amount: float) -> float:
        return usd_amount + zig_amount / data.exchange_rate

    cos_usd_equiv = usd_equiv(data.usd_expenses.cost_of_sales, data.zig_expenses.cost_of_sales)
    sal_usd_equiv = usd_equiv(data.usd_expenses.salaries, data.zig_expenses.salaries)
    oth_usd_equiv = usd_equiv(data.usd_expenses.other_expenses, data.zig_expenses.other_expenses)
    cap_usd_equiv = usd_equiv(data.usd_expenses.capital_allowances, data.zig_expenses.capital_allowances)

    # --- Adjusted income (ITF12C row 20: D20 =D9*H7 / F20 =F9*H7*G6) ---
    adjusted_income_usd = payment_ratio_usd * total_income_usd
    adjusted_income_zig = payment_ratio_zig * total_income_usd * data.exchange_rate

    # --- Adjusted deductions (ITF12C rows 22-29, each re-split by the payment ratio) ---
    def split(line_usd_equiv: float) -> tuple[float, float]:
        return (
            payment_ratio_usd * line_usd_equiv,
            payment_ratio_zig * line_usd_equiv * data.exchange_rate,
        )

    cos_u, cos_z = split(cos_usd_equiv)
    sal_u, sal_z = split(sal_usd_equiv)
    oth_u, oth_z = split(oth_usd_equiv)
    cap_u, cap_z = split(cap_usd_equiv)

    adjusted_deductions_usd = cos_u + sal_u + oth_u + cap_u  # ITF12C D21
    adjusted_deductions_zig = cos_z + sal_z + oth_z + cap_z  # ITF12C F21

    # --- Taxable profit (ITF12C row 30) ---
    taxable_profit_usd = max(0.0, adjusted_income_usd - adjusted_deductions_usd)
    taxable_profit_zig = max(0.0, adjusted_income_zig - adjusted_deductions_zig)

    # --- Tax payable + AIDS levy (ITF12C rows 31-33) ---
    tax_payable_usd = taxable_profit_usd * data.tax_rate
    tax_payable_zig = taxable_profit_zig * data.tax_rate
    aids_levy_usd = tax_payable_usd * data.aids_levy_rate
    aids_levy_zig = tax_payable_zig * data.aids_levy_rate
    total_tax_usd = tax_payable_usd + aids_levy_usd
    total_tax_zig = tax_payable_zig + aids_levy_zig

    # --- QPD schedule (ITF12C rows 36-39, fixed: no dead E-column reference) ---
    schedule = [
        QpdInstalment("Q1 - 25 March", 0.10, round(total_tax_usd * 0.10, 2), round(total_tax_zig * 0.10, 2)),
        QpdInstalment("Q2 - 25 June", 0.25, round(total_tax_usd * 0.25, 2), round(total_tax_zig * 0.25, 2)),
        QpdInstalment("Q3 - 25 September", 0.30, round(total_tax_usd * 0.30, 2), round(total_tax_zig * 0.30, 2)),
        QpdInstalment("Q4 - 20 December", 0.35, round(total_tax_usd * 0.35, 2), round(total_tax_zig * 0.35, 2)),
    ]

    return QpdResult(
        usd_ratio=usd_ratio,
        zig_ratio=zig_ratio,
        payment_ratio_usd=payment_ratio_usd,
        payment_ratio_zig=payment_ratio_zig,
        adjusted_income_usd=adjusted_income_usd,
        adjusted_income_zig=adjusted_income_zig,
        adjusted_deductions_usd=adjusted_deductions_usd,
        adjusted_deductions_zig=adjusted_deductions_zig,
        taxable_profit_usd=taxable_profit_usd,
        taxable_profit_zig=taxable_profit_zig,
        tax_payable_usd=tax_payable_usd,
        tax_payable_zig=tax_payable_zig,
        aids_levy_usd=aids_levy_usd,
        aids_levy_zig=aids_levy_zig,
        total_tax_usd=total_tax_usd,
        total_tax_zig=total_tax_zig,
        schedule=schedule,
    )


def apply_payments(
    schedule: list[QpdInstalment], usd_paid: list[float], zig_paid: list[float]
) -> list[QpdInstalment]:
    """
    Working replacement for the original 'QPD Payments Made' section, which
    never actually computed anything (rows 41-46 referenced blank cells).

    usd_paid / zig_paid: amounts actually paid for Q1..Q4, in order. Pass 0
    for any quarter not yet paid. Returns the same instalments with
    usd_paid/zig_paid/usd_balance/zig_balance filled in.
    """
    if len(usd_paid) != len(schedule) or len(zig_paid) != len(schedule):
        raise ValueError("usd_paid and zig_paid must have one entry per instalment")

    for instalment, u_paid, z_paid in zip(schedule, usd_paid, zig_paid):
        instalment.usd_paid = u_paid
        instalment.zig_paid = z_paid

    return schedule


def project_annual_from_quarter(quarter_value: float, quarters_elapsed: int = 1) -> float:
    """
    Reproduces the workbook's annualisation shortcut (USD/ZIG sheets, column H):
    assume the remaining quarters mirror the quarter(s) already observed.

    This is a provisional *estimate* aid, not a ZIMRA rule - it's a modelling
    convenience for filling in early-year QPDs before real Q2-Q4 data exists.
    Swap in real quarterly figures as the year progresses instead of relying
    on this projection past Q1.
    """
    if quarters_elapsed <= 0:
        raise ValueError("quarters_elapsed must be at least 1")
    return (quarter_value / quarters_elapsed) * 4

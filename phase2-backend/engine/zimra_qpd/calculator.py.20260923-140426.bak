"""
ZIMRA QPD calculation engine.

This is a direct port of the logic in the "ITF12C 2025" master sheet of the
source workbook (2026 QPD Calculator.xlsx), with known bugs fixed along
the way:

1. The original QPD schedule's column E (`E36:E39`) referenced an empty
   cell (`E33`) and silently evaluated to zero. That dead reference doesn't
   exist here - the schedule is computed straight from total_tax.
2. The "QPD Payments Made" section (rows 41-46) referenced blank cells the
   same way and never actually tracked payments. `apply_payments()` below
   is a working replacement.
3. Zero-income-with-real-expenses: when both currencies show $0 sales but
   real expenses were entered, the raw ratio math defaults to 0.0/0.0
   (which is not >, so it silently fell into the uncapped branch as 0/0),
   zeroing out "adjusted deductions" even though real numbers were
   entered. Fixed with an explicit total_income_usd==0 branch below. Final
   tax owed is unaffected (taxable profit clamps at 0 regardless) - this
   only fixes a misleading intermediate figure.
4. Float precision: every step from here to the final instalment used to
   run on Python's native `float` (IEEE-754 binary double). Doubles are
   individually accurate to ~15-17 significant digits, which is normally
   plenty - but this engine chains 6+ multiplications/divisions per figure
   (ratio -> split -> adjusted income/deductions -> taxable profit -> tax
   -> AIDS levy -> instalment), and ratios/exchange rates are frequently
   repeating binary fractions (e.g. anything that isn't a power of two
   denominator). Each step's tiny representation error can compound, and
   the *rounding itself* (Python's builtin `round()` uses round-half-to-
   even / "banker's rounding", not the round-half-up that ZIMRA and every
   accounting convention expects) was a second, independent source of
   off-by-a-cent risk. Both are fixed below: all arithmetic from the raw
   inputs through to taxable profit / tax / AIDS levy runs on `Decimal` at
   50 significant digits (see `getcontext().prec` below), and the only two
   places a value is ever rounded to the cent - the quarterly instalments
   and the payment balances - use explicit ROUND_HALF_UP. Every other
   returned figure (ratios, adjusted income/deductions, taxable profit,
   tax payable, AIDS levy, total tax) is still returned as a plain
   `float`, unrounded, exactly as before - this change only affects how
   precisely it gets there and how the final cents are rounded, not the
   public shape of anything.

Every formula below is commented with the ITF12C cell it replicates, so the
logic can be checked line-by-line against the original workbook.

Current ZIMRA rates: corporate tax 25%, AIDS levy 3% of the tax payable
(not of income) -> 25.75% effective. CONFIRMED against ZIMRA's own official
site (zimra.co.zw/domestic-taxes/corporate/tax-rates, "Income of company or
trust: 25%" + "Aids Levy: Rate is based on tax chargeable: 3%") as of
August 2026 - this resolves an earlier discrepancy against some third-party
sites quoting a stale 24%+3%=24.72% figure. Re-verify on ZIMRA's site (or
the TaRMS portal) at the start of each tax year, since rates change via
annual budget/public notice. Both rates are exposed as parameters, not
hardcoded, so a rate change is a one-line default update, not a rebuild.

5. CUMULATIVE QPD LOGIC (added - this is the actual bug the workbook had):

   The workbook (and this engine, until now) computed one annual tax
   estimate and sliced it into four INDEPENDENT flat shares (10/25/30/35%
   of ONE number, entered once). That's only correct if a business's
   estimate never changes all year. It's not how ZIMRA actually requires
   QPDs to work.

   ZIMRA's own guidance (FAQ "How do you calculate amounts paid on QPD",
   public-notice 19/2023, and multiple 2025/2026 practitioner writeups)
   is explicit: "The annual estimated tax due should be revised to update
   the estimate every quarter... the actual amount due at the quarter must
   be arrived at after deducting the QPDs already paid from the amount
   due." That's a CUMULATIVE calculation against your CURRENT best
   estimate, netted against what was actually remitted in prior quarters -
   not four independent slices of a number frozen at Q1.

   Concretely, for quarter N with cumulative percentage C(N):
     C(1)=10%, C(2)=35%, C(3)=65%, C(4)=100%
     net_payable(N) = max(0, total_tax(current estimate) * C(N) - sum of
                              QPDs ACTUALLY PAID in quarters 1..N-1)

   `calculate_qpd()` now takes `quarter` and `previous_qpds_paid_usd/zig`
   and returns `net_payable_usd/zig` - the one number that's actually owed
   right now - alongside the existing `schedule`, which is kept as a
   full-year PROJECTION ("if this estimate holds for the rest of the
   year, here's roughly how the remaining quarters would land") and must
   never be presented as a bill for a future quarter.

   Backward compatibility: when an estimate never changes between
   quarters and every quarter is paid in full and on time,
   net_payable(N) equals the old flat-share table exactly (verified: with
   total_tax=12.875, feeding each quarter's own cumulative due back in as
   "previous paid" reproduces 1.2875 / 3.21875 / 3.8625 / 4.50625 to the
   last decimal). The new fields default to quarter=1 and zero prior
   payments, so every existing caller that doesn't pass them gets
   identical output to before.

6. ASSESSED LOSSES + WITHHOLDING TAX CREDITS (new):
   `assessed_loss_usd/zig` reduces taxable profit (the base tax is
   computed on) before tax_payable/aids_levy are calculated, so a loss
   correctly shrinks both. `withholding_credits_usd/zig` is netted off
   the cumulative amount due at every quarter checkpoint, the same way
   previous_qpds_paid already is - it represents tax ZIMRA already holds
   against this business (e.g. clients withheld 30% for lack of an
   ITF263 clearance), not a percentage-scaled discount. Both default to
   0.0, so every existing caller is unaffected.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP, getcontext

# 50 significant digits is far beyond anything a tax figure needs - it only
# has to be "large enough that binary/rounding error never surfaces even
# after several chained operations", and 50 clears that with huge margin.
# This is set once, at import time, for this module's own calculations.
getcontext().prec = 50

_CENTS = Decimal("0.01")

# Cumulative percentage of the annual estimate due BY (not AT) each QPD,
# per ZIMRA's published schedule (10/25/30/35% quarterly shares, read
# cumulatively: 10%, 10+25=35%, 35+30=65%, 65+35=100%).
QUARTER_CUMULATIVE_PERCENTAGE: dict[int, Decimal] = {
    1: Decimal("0.10"),
    2: Decimal("0.35"),
    3: Decimal("0.65"),
    4: Decimal("1.00"),
}

QUARTER_DUE_DATES: dict[int, str] = {
    1: "25 March",
    2: "25 June",
    3: "25 September",
    4: "20 December",
}


def _d(value: float | int | str | Decimal) -> Decimal:
    """
    Converts any incoming number to Decimal safely.

    Always goes through str() first - NEVER Decimal(some_float) directly.
    Decimal(0.1) reproduces the float's actual stored binary value
    (0.1000000000000000055511151231257827021181583404541015625), which
    defeats the entire purpose of switching to Decimal. str(0.1) gives
    "0.1", which Decimal parses exactly as the person actually typed it.
    """
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _money(value: Decimal) -> float:
    """
    Rounds a Decimal to the cent using ROUND_HALF_UP - what ZIMRA and every
    accounting convention expects, unlike Python's builtin round(), which
    uses round-half-to-even and can round e.g. 0.125 down instead of up -
    then converts to a plain float for the public dataclasses, so every
    existing downstream consumer (Pydantic schemas, JSONB storage, the
    frontend) keeps working with ordinary numbers exactly as before.
    """
    return float(value.quantize(_CENTS, rounding=ROUND_HALF_UP))


@dataclass
class CurrencyExpenses:
    """One currency's allowable deductions for the year (ITF12C rows 10-17)."""

    cost_of_sales: float = 0.0
    salaries: float = 0.0
    other_expenses: float = 0.0
    capital_allowances: float = 0.0

    def total(self) -> float:
        return float(
            _d(self.cost_of_sales)
            + _d(self.salaries)
            + _d(self.other_expenses)
            + _d(self.capital_allowances)
        )


@dataclass
class QpdInput:
    """
    Annual estimates for one business, in both trading currencies.

    Fields stay typed as `float` for backward compatibility with every
    existing caller (FastAPI/Pydantic passes floats in from JSON) - they
    are converted to Decimal internally the moment calculate_qpd() runs.
    Passing a `str` (e.g. "12000.50") or a `Decimal` directly also works
    and is slightly preferable if a caller ever has the exact string a
    user typed, since it skips a redundant float round-trip.
    """

    usd_sales: float
    zig_sales: float
    usd_expenses: CurrencyExpenses = field(default_factory=CurrencyExpenses)
    zig_expenses: CurrencyExpenses = field(default_factory=CurrencyExpenses)
    exchange_rate: float = 26.8  # ZIG per 1 USD - update to the current interbank rate
    tax_rate: float = 0.25       # ZIMRA corporate tax rate
    aids_levy_rate: float = 0.03  # charged on tax payable, not on income

    # Which QPD this calculation is FOR (1=March, 2=June, 3=September,
    # 4=December). Drives the cumulative-percentage lookup below.
    quarter: int = 1

    # What was ACTUALLY remitted to ZIMRA for this business/tax year in
    # every quarter BEFORE this one, combined. Use real payment amounts,
    # not the previously-calculated theoretical figures - if a business
    # revised its estimate or under/overpaid, those are what ZIMRA
    # actually holds on account, and that's what this quarter's payment
    # must net against.
    previous_qpds_paid_usd: float = 0.0
    previous_qpds_paid_zig: float = 0.0

    # Optional annual adjustments (all default to 0.0 -> byte-for-byte
    # identical behaviour to every existing caller; only affects output
    # when a business actually has one of these). New in this revision -
    # see calculate_qpd() for exactly where each is applied.
    assessed_loss_usd: float = 0.0        # prior-year assessed tax loss b/f, USD
    assessed_loss_zig: float = 0.0        # prior-year assessed tax loss b/f, ZIG
    withholding_credits_usd: float = 0.0  # WHT already suffered (e.g. no ITF263), USD
    withholding_credits_zig: float = 0.0  # WHT already suffered (e.g. no ITF263), ZIG


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
        return _money(_d(self.usd) - _d(self.usd_paid))

    @property
    def zig_balance(self) -> float:
        return _money(_d(self.zig) - _d(self.zig_paid))


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

    # --- The actual amount owed THIS quarter (the headline figure) ---
    quarter: int
    due_date: str
    cumulative_percentage: float
    cumulative_due_usd: float
    cumulative_due_zig: float
    previous_paid_usd: float
    previous_paid_zig: float
    net_payable_usd: float
    net_payable_zig: float


def calculate_qpd(data: QpdInput) -> QpdResult:
    exchange_rate = _d(data.exchange_rate)
    if exchange_rate <= 0:
        raise ValueError("exchange_rate must be greater than zero")

    usd_sales = _d(data.usd_sales)
    zig_sales = _d(data.zig_sales)
    if usd_sales < 0 or zig_sales < 0:
        raise ValueError("sales figures cannot be negative")

    tax_rate = _d(data.tax_rate)
    aids_levy_rate = _d(data.aids_levy_rate)

    if data.quarter not in QUARTER_CUMULATIVE_PERCENTAGE:
        raise ValueError("quarter must be 1, 2, 3, or 4")

    previous_paid_usd = _d(data.previous_qpds_paid_usd)
    previous_paid_zig = _d(data.previous_qpds_paid_zig)
    assessed_loss_usd_in = _d(data.assessed_loss_usd)
    assessed_loss_zig_in = _d(data.assessed_loss_zig)
    withholding_credits_usd_in = _d(data.withholding_credits_usd)
    withholding_credits_zig_in = _d(data.withholding_credits_zig)
    if (
        assessed_loss_usd_in < 0
        or assessed_loss_zig_in < 0
        or withholding_credits_usd_in < 0
        or withholding_credits_zig_in < 0
    ):
        raise ValueError("assessed_loss_usd/zig and withholding_credits_usd/zig cannot be negative")
    if previous_paid_usd < 0 or previous_paid_zig < 0:
        raise ValueError("previous_qpds_paid_usd/zig cannot be negative")

    ZERO = Decimal(0)
    HALF = Decimal("0.5")

    # --- Currency normalisation (ITF12C rows 6-7) ---
    zig_sales_in_usd = zig_sales / exchange_rate
    total_income_usd = usd_sales + zig_sales_in_usd  # ITF12C H7

    # --- Currency ratios (ITF12C row 8) ---
    usd_ratio = usd_sales / total_income_usd if total_income_usd > ZERO else ZERO
    zig_ratio = zig_sales_in_usd / total_income_usd if total_income_usd > ZERO else ZERO

    # --- Public Notice 71 50/50 capping rule (ITF12C row 9) ---
    # Cap applies ONLY when USD is the dominant trading currency
    # (D9: =IF(D8>F8, 0.5, D8)  /  F9: =IF(D8>F8, 0.5, F8)).
    # If ZIG is dominant or equal, tax uses the real currency-of-trade ratio, uncapped.
    #
    # Zero-income edge case (fix, not present in the raw workbook - the raw
    # sheet would show #DIV/0! here since D8/F8 = D7/H7 with H7=0): when a
    # business has $0 sales in BOTH currencies but has real entered expenses
    # (e.g. a new business's first quarter, spent before selling anything),
    # usd_ratio and zig_ratio both default to 0, and 0 > 0 is False, so
    # without this branch the code would fall into the "else" and set
    # payment_ratio_usd/zig to 0 as well - silently zeroing out
    # adjusted_deductions even though real expenses were entered. The final
    # tax is 0 either way (taxable profit is clamped at 0 below regardless
    # of how the ratio splits), but the *displayed* "Adjusted deductions"
    # figure would misleadingly show $0, which looks like data loss to the
    # user. Defaulting to 50/50 here keeps that figure honest without
    # changing the tax outcome.
    if total_income_usd == ZERO:
        payment_ratio_usd = HALF
        payment_ratio_zig = HALF
    elif usd_ratio > zig_ratio:
        payment_ratio_usd = HALF
        payment_ratio_zig = HALF
    else:
        payment_ratio_usd = usd_ratio
        payment_ratio_zig = zig_ratio

    # --- Expense lines, converted to a USD-equivalent baseline (ITF12C column H) ---
    def usd_equiv(usd_amount: float, zig_amount: float) -> Decimal:
        return _d(usd_amount) + _d(zig_amount) / exchange_rate

    cos_usd_equiv = usd_equiv(data.usd_expenses.cost_of_sales, data.zig_expenses.cost_of_sales)
    sal_usd_equiv = usd_equiv(data.usd_expenses.salaries, data.zig_expenses.salaries)
    oth_usd_equiv = usd_equiv(data.usd_expenses.other_expenses, data.zig_expenses.other_expenses)
    cap_usd_equiv = usd_equiv(data.usd_expenses.capital_allowances, data.zig_expenses.capital_allowances)

    # --- Adjusted income (ITF12C row 20: D20 =D9*H7 / F20 =F9*H7*G6) ---
    adjusted_income_usd = payment_ratio_usd * total_income_usd
    adjusted_income_zig = payment_ratio_zig * total_income_usd * exchange_rate

    # --- Adjusted deductions (ITF12C rows 22-29, each re-split by the payment ratio) ---
    def split(line_usd_equiv: Decimal) -> tuple[Decimal, Decimal]:
        return (
            payment_ratio_usd * line_usd_equiv,
            payment_ratio_zig * line_usd_equiv * exchange_rate,
        )

    cos_u, cos_z = split(cos_usd_equiv)
    sal_u, sal_z = split(sal_usd_equiv)
    oth_u, oth_z = split(oth_usd_equiv)
    cap_u, cap_z = split(cap_usd_equiv)

    adjusted_deductions_usd = cos_u + sal_u + oth_u + cap_u  # ITF12C D21
    adjusted_deductions_zig = cos_z + sal_z + oth_z + cap_z  # ITF12C F21

    # --- Taxable profit (ITF12C row 30) ---
    taxable_profit_usd = max(ZERO, adjusted_income_usd - adjusted_deductions_usd)
    taxable_profit_zig = max(ZERO, adjusted_income_zig - adjusted_deductions_zig)

    # --- Assessed losses b/f (new) ---
    # Reduces the taxable BASE before tax is computed on it, not a credit
    # bolted onto the tax figure afterward - so it correctly flows through
    # into a smaller AIDS levy too (3% of a smaller tax_payable), exactly
    # as ZIMRA's own ITF12C treats a loss carried forward.
    taxable_profit_usd = max(ZERO, taxable_profit_usd - assessed_loss_usd_in)
    taxable_profit_zig = max(ZERO, taxable_profit_zig - assessed_loss_zig_in)

    # --- Tax payable + AIDS levy (ITF12C rows 31-33) ---
    tax_payable_usd = taxable_profit_usd * tax_rate
    tax_payable_zig = taxable_profit_zig * tax_rate
    aids_levy_usd = tax_payable_usd * aids_levy_rate
    aids_levy_zig = tax_payable_zig * aids_levy_rate
    total_tax_usd = tax_payable_usd + aids_levy_usd
    total_tax_zig = tax_payable_zig + aids_levy_zig

    # --- QPD schedule (ITF12C rows 36-39, fixed: no dead E-column reference) ---
    # This is the ONE place money gets rounded to the cent - via _money()
    # (Decimal ROUND_HALF_UP), replacing the old round(x, 2) (banker's
    # rounding). Everything above stays at full Decimal precision right up
    # until this point.
    schedule = [
        QpdInstalment("Q1 - 25 March", 0.10, _money(total_tax_usd * Decimal("0.10")), _money(total_tax_zig * Decimal("0.10"))),
        QpdInstalment("Q2 - 25 June", 0.25, _money(total_tax_usd * Decimal("0.25")), _money(total_tax_zig * Decimal("0.25"))),
        QpdInstalment("Q3 - 25 September", 0.30, _money(total_tax_usd * Decimal("0.30")), _money(total_tax_zig * Decimal("0.30"))),
        QpdInstalment("Q4 - 20 December", 0.35, _money(total_tax_usd * Decimal("0.35")), _money(total_tax_zig * Decimal("0.35"))),
    ]

    # --- Cumulative amount actually due THIS quarter (fixes the workbook's
    # flat-share bug: see module docstring section 5). Uses the CURRENT
    # estimate's total_tax, cumulative-to-date, minus what was genuinely
    # paid in prior quarters - not a fixed slice of a number frozen at Q1. ---
    cumulative_pct = QUARTER_CUMULATIVE_PERCENTAGE[data.quarter]
    cumulative_due_usd = total_tax_usd * cumulative_pct
    cumulative_due_zig = total_tax_zig * cumulative_pct
    # Withholding tax credits (new): WHT already suffered this tax year
    # (e.g. a client withheld 30% for lack of an ITF263 tax clearance) is
    # tax ZIMRA already holds on your account, so it's netted off exactly
    # like previous_qpds_paid - a flat reduction against the cumulative
    # due at every checkpoint, not prorated by the quarter's percentage.
    net_payable_usd = max(ZERO, cumulative_due_usd - previous_paid_usd - withholding_credits_usd_in)
    net_payable_zig = max(ZERO, cumulative_due_zig - previous_paid_zig - withholding_credits_zig_in)

    return QpdResult(
        usd_ratio=float(usd_ratio),
        zig_ratio=float(zig_ratio),
        payment_ratio_usd=float(payment_ratio_usd),
        payment_ratio_zig=float(payment_ratio_zig),
        adjusted_income_usd=float(adjusted_income_usd),
        adjusted_income_zig=float(adjusted_income_zig),
        adjusted_deductions_usd=float(adjusted_deductions_usd),
        adjusted_deductions_zig=float(adjusted_deductions_zig),
        taxable_profit_usd=float(taxable_profit_usd),
        taxable_profit_zig=float(taxable_profit_zig),
        tax_payable_usd=float(tax_payable_usd),
        tax_payable_zig=float(tax_payable_zig),
        aids_levy_usd=float(aids_levy_usd),
        aids_levy_zig=float(aids_levy_zig),
        total_tax_usd=float(total_tax_usd),
        total_tax_zig=float(total_tax_zig),
        schedule=schedule,
        quarter=data.quarter,
        due_date=QUARTER_DUE_DATES[data.quarter],
        cumulative_percentage=float(cumulative_pct),
        cumulative_due_usd=_money(cumulative_due_usd),
        cumulative_due_zig=_money(cumulative_due_zig),
        previous_paid_usd=_money(previous_paid_usd),
        previous_paid_zig=_money(previous_paid_zig),
        net_payable_usd=_money(net_payable_usd),
        net_payable_zig=_money(net_payable_zig),
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

    This is a provisional *estimate* aid, not a ZIMRA rule, and never feeds
    into the tax-critical calculation chain above - it stays on plain
    float arithmetic intentionally, since a single divide-then-multiply
    has no meaningful precision risk on its own.

    Swap in real quarterly figures as the year progresses instead of relying
    on this projection past Q1.
    """
    if quarters_elapsed <= 0:
        raise ValueError("quarters_elapsed must be at least 1")
    return (quarter_value / quarters_elapsed) * 4
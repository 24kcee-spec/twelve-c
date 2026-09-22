"""
Worked examples: two fictional Bulawayo companies taken through a full 2026
QPD cycle with the REAL engine.

Every figure a person would key into the platform is here, exactly as they
would have known it on each due date:

  1. months trading so far (actuals) + the estimate for the month still open,
  2. the annual expense estimates as revised at that QPD,
  3. any assessed loss b/f and withholding-tax credits,
  4. what was actually remitted to ZIMRA for the quarter.

run_company() then does what the platform does: annualise the months in play
(rolling_estimate), feed calculate_qpd(), net against what was genuinely paid
in earlier quarters, and record what is paid this quarter. The xlsx working
papers are built from the same data, and tests/test_worked_examples.py pins
every headline figure so a change to the engine can't drift silently.

These are teaching figures. They are not real taxpayers.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .calculator import CurrencyExpenses, QpdInput, QpdResult, calculate_qpd
from .rolling_estimate import (
    MONTHS_ELAPSED_BY_QUARTER,
    RollingEstimate,
    rolling_annual_estimate,
    window_for_quarter,
)

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class QuarterAssumptions:
    """What the accountant knew and decided on the due date of one QPD."""

    quarter: int
    estimate_usd: float                 # estimate for the month still open (last month of the window)
    estimate_zig: float
    usd_expenses: CurrencyExpenses      # ANNUAL estimates as revised at this QPD
    zig_expenses: CurrencyExpenses
    one_off_usd: float = 0.0
    one_off_zig: float = 0.0
    buffer_pct_usd: float = 0.0
    buffer_pct_zig: float = 0.0
    assessed_loss_usd: float = 0.0
    assessed_loss_zig: float = 0.0
    withholding_credits_usd: float = 0.0    # cumulative WHT suffered to date
    withholding_credits_zig: float = 0.0
    # Share of the net amount due that was actually remitted (1.0 = paid in full).
    paid_fraction_usd: float = 1.0
    paid_fraction_zig: float = 1.0
    note: str = ""


@dataclass
class WorkedCompany:
    key: str
    name: str
    trade: str
    tax_year: int
    exchange_rate: float
    usd_actuals: list[float]            # 12 months; months after the QPD are simply not used yet
    zig_actuals: list[float]
    quarters: list[QuarterAssumptions]
    story: str = ""


@dataclass
class QuarterRun:
    quarter: int
    window_usd: list[float]
    window_zig: list[float]
    est_usd: RollingEstimate
    est_zig: RollingEstimate
    engine_input: QpdInput
    result: QpdResult
    paid_usd: float
    paid_zig: float
    assumptions: QuarterAssumptions = field(repr=False, default=None)  # type: ignore[assignment]


def run_company(company: WorkedCompany) -> list[QuarterRun]:
    runs: list[QuarterRun] = []
    prev_paid_usd = 0.0
    prev_paid_zig = 0.0

    for qa in sorted(company.quarters, key=lambda q: q.quarter):
        n = MONTHS_ELAPSED_BY_QUARTER[qa.quarter]

        # The window: closed months as actuals, LAST month replaced by the estimate.
        win_usd = window_for_quarter(company.usd_actuals, qa.quarter)
        win_zig = window_for_quarter(company.zig_actuals, qa.quarter)
        win_usd[n - 1] = qa.estimate_usd
        win_zig[n - 1] = qa.estimate_zig

        est_usd = rolling_annual_estimate(win_usd, one_off=qa.one_off_usd, buffer_pct=qa.buffer_pct_usd)
        est_zig = rolling_annual_estimate(win_zig, one_off=qa.one_off_zig, buffer_pct=qa.buffer_pct_zig)

        engine_input = QpdInput(
            usd_sales=est_usd.estimate,
            zig_sales=est_zig.estimate,
            usd_expenses=qa.usd_expenses,
            zig_expenses=qa.zig_expenses,
            exchange_rate=company.exchange_rate,
            quarter=qa.quarter,
            previous_qpds_paid_usd=prev_paid_usd,
            previous_qpds_paid_zig=prev_paid_zig,
            assessed_loss_usd=qa.assessed_loss_usd,
            assessed_loss_zig=qa.assessed_loss_zig,
            withholding_credits_usd=qa.withholding_credits_usd,
            withholding_credits_zig=qa.withholding_credits_zig,
        )
        result = calculate_qpd(engine_input)

        paid_usd = round(result.net_payable_usd * qa.paid_fraction_usd, 2)
        paid_zig = round(result.net_payable_zig * qa.paid_fraction_zig, 2)

        runs.append(
            QuarterRun(
                quarter=qa.quarter,
                window_usd=win_usd,
                window_zig=win_zig,
                est_usd=est_usd,
                est_zig=est_zig,
                engine_input=engine_input,
                result=result,
                paid_usd=paid_usd,
                paid_zig=paid_zig,
                assumptions=qa,
            )
        )
        prev_paid_usd = round(prev_paid_usd + paid_usd, 2)
        prev_paid_zig = round(prev_paid_zig + paid_zig, 2)

    return runs


# ---------------------------------------------------------------------------
# Company A - USD-dominant trader: the 50/50 payment-ratio cap applies.
# ---------------------------------------------------------------------------

KHAMI = WorkedCompany(
    key="khami",
    name="Khami Building Supplies (Pvt) Ltd",
    trade="Hardware and building-materials wholesaler, Bulawayo. Trades mostly in USD with a smaller ZiG walk-in trade.",
    tax_year=2026,
    exchange_rate=26.8,
    usd_actuals=[41500, 38200, 45300, 43800, 47100, 49500, 46200, 48900, 52300, 50100, 55400, 61000],
    zig_actuals=[210000, 185000, 240000, 225000, 260000, 275000, 250000, 265000, 290000, 280000, 310000, 340000],
    story=(
        "Sales grow through the year, so the early annualised estimates are low and the "
        "instalments catch up later. USD is about 83% of trade, so the 50/50 payment-ratio cap "
        "applies: half the tax is paid in USD and half in ZiG regardless of the real split. "
        "A new delivery truck bought in August lifts capital allowances at QPD3. Customers "
        "withheld some tax, which is credited against what is due."
    ),
    quarters=[
        QuarterAssumptions(
            quarter=1, estimate_usd=44000, estimate_zig=230000,
            buffer_pct_usd=5, buffer_pct_zig=5,
            usd_expenses=CurrencyExpenses(cost_of_sales=350000, salaries=62000, other_expenses=48000, capital_allowances=8000),
            zig_expenses=CurrencyExpenses(cost_of_sales=1700000, salaries=520000, other_expenses=390000),
            note="First QPD: only Jan and Feb are closed. 5% buffer because March is a guess.",
        ),
        QuarterAssumptions(
            quarter=2, estimate_usd=48000, estimate_zig=270000,
            buffer_pct_usd=5, buffer_pct_zig=5,
            usd_expenses=CurrencyExpenses(cost_of_sales=358000, salaries=64000, other_expenses=51000, capital_allowances=8000),
            zig_expenses=CurrencyExpenses(cost_of_sales=1780000, salaries=535000, other_expenses=405000),
            withholding_credits_usd=900,
            note="Jan-May are now actuals (March's estimate replaced by the real figure). USD 900 withheld by customers.",
        ),
        QuarterAssumptions(
            quarter=3, estimate_usd=53000, estimate_zig=290000,
            usd_expenses=CurrencyExpenses(cost_of_sales=362000, salaries=65500, other_expenses=52000, capital_allowances=12000),
            zig_expenses=CurrencyExpenses(cost_of_sales=1820000, salaries=545000, other_expenses=415000),
            withholding_credits_usd=900,
            note="Buffer dropped: eight months are actual. Truck added to capital allowances.",
        ),
        QuarterAssumptions(
            quarter=4, estimate_usd=58000, estimate_zig=320000,
            usd_expenses=CurrencyExpenses(cost_of_sales=372000, salaries=68000, other_expenses=55000, capital_allowances=12000),
            zig_expenses=CurrencyExpenses(cost_of_sales=1900000, salaries=560000, other_expenses=430000),
            withholding_credits_usd=1500,
            note="Final QPD: eleven months actual. Withholding credits have grown to USD 1,500.",
        ),
    ],
)

# ---------------------------------------------------------------------------
# Company B - ZiG-dominant: the real currency ratio is used, uncapped.
# ---------------------------------------------------------------------------

UMGUZA = WorkedCompany(
    key="umguza",
    name="Umguza Bakers (Pvt) Ltd",
    trade="Bakery and confectionery, Bulawayo. Mostly ZiG retail counter sales plus USD wholesale to lodges.",
    tax_year=2026,
    exchange_rate=26.8,
    usd_actuals=[6200, 5800, 6900, 7100, 7400, 7000, 6800, 7300, 7900, 8100, 9200, 10400],
    zig_actuals=[610000, 580000, 640000, 655000, 690000, 700000, 685000, 720000, 760000, 790000, 880000, 990000],
    story=(
        "ZiG is about 78% of trade, so the 50/50 cap does NOT apply: tax follows the real "
        "currency ratio. The company brings a ZiG assessed loss from 2025, short-pays QPD2 "
        "(cash-flow squeeze) and lands a one-off USD catering contract at QPD3. Because the "
        "engine nets against what was actually paid, the shortfall is picked up automatically "
        "in QPD3."
    ),
    quarters=[
        QuarterAssumptions(
            quarter=1, estimate_usd=6500, estimate_zig=620000,
            usd_expenses=CurrencyExpenses(cost_of_sales=40000, salaries=11000, other_expenses=8000),
            zig_expenses=CurrencyExpenses(cost_of_sales=4700000, salaries=1200000, other_expenses=780000),
            assessed_loss_zig=350000,
            note="Assessed loss of ZiG 350,000 brought forward from 2025.",
        ),
        QuarterAssumptions(
            quarter=2, estimate_usd=7200, estimate_zig=690000,
            usd_expenses=CurrencyExpenses(cost_of_sales=42000, salaries=11500, other_expenses=8500),
            zig_expenses=CurrencyExpenses(cost_of_sales=4900000, salaries=1280000, other_expenses=820000),
            assessed_loss_zig=350000,
            paid_fraction_zig=0.8,
            note="Cash-flow squeeze: only about 80% of the ZiG due is actually paid.",
        ),
        QuarterAssumptions(
            quarter=3, estimate_usd=7800, estimate_zig=750000,
            one_off_usd=4000,
            usd_expenses=CurrencyExpenses(cost_of_sales=44000, salaries=12000, other_expenses=9000),
            zig_expenses=CurrencyExpenses(cost_of_sales=5100000, salaries=1350000, other_expenses=860000, capital_allowances=240000),
            assessed_loss_zig=350000,
            note="One-off USD 4,000 catering contract added; new oven adds ZiG capital allowances. The QPD2 shortfall is caught up here.",
        ),
        QuarterAssumptions(
            quarter=4, estimate_usd=10000, estimate_zig=950000,
            usd_expenses=CurrencyExpenses(cost_of_sales=45000, salaries=12000, other_expenses=9000),
            zig_expenses=CurrencyExpenses(cost_of_sales=5300000, salaries=1400000, other_expenses=900000, capital_allowances=240000),
            assessed_loss_zig=350000,
            note="Final QPD: eleven months actual.",
        ),
    ],
)

WORKED_COMPANIES: dict[str, WorkedCompany] = {c.key: c for c in (KHAMI, UMGUZA)}

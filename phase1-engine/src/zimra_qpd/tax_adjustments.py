"""
Trial-balance -> tax-deductible-expenses reconciliation - optional helper.

Lets you hand over raw accounting figures (turnover, cost of sales,
salaries, other operating expenses AS BOOKED, finance costs) plus the
ZIMRA-disallowed items embedded inside them, and get back a single
tax-deductible "other_expenses" figure that plugs straight into the
existing CurrencyExpenses/calculate_qpd() pipeline in calculator.py,
unchanged.

IMPORTANT - this deliberately does NOT follow the naive add-back formula
sometimes floated in generic ZIMRA QPD writeups (PBT = turnover - cost_of_sales
- salaries - other_opex - depreciation - finance_costs, then add back
depreciation + donations + entertainment + fines). That formula only ever
subtracts depreciation from PBT in the first place - donations/entertainment/
fines are never subtracted - then adds all four back a second time, which
overstates taxable income by double-counting three of the four items for any
business with real entertainment or fines expenditure.

The correct mechanics used here: `other_operating_expenses` as booked in the
accounts ALREADY includes depreciation, unapproved donations, entertainment
and fines (they were real costs that reduced accounting profit). Tax law
disallows deducting them, so they're removed from the deductible expense
figure before it reaches PBT - mathematically identical to the textbook
"add back to PBT" treatment, without the double-count.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .calculator import _d, _money


@dataclass
class AddBacks:
    """
    Non-deductible items ALREADY INCLUDED inside `other_operating_expenses`
    on the trial balance - not additional to it. If depreciation, donations,
    entertainment or fines were booked to a different line, move their
    values here and make sure they are NOT double-counted elsewhere.
    """

    depreciation: float = 0.0
    unapproved_donations: float = 0.0
    entertainment: float = 0.0
    fines_penalties: float = 0.0

    def total(self) -> float:
        return float(
            _d(self.depreciation)
            + _d(self.unapproved_donations)
            + _d(self.entertainment)
            + _d(self.fines_penalties)
        )


@dataclass
class TrialBalanceLine:
    """One currency's raw accounting figures for the year, pre-tax-adjustment."""

    turnover: float
    cost_of_sales: float
    salaries: float
    other_operating_expenses: float  # as booked - INCLUDES the addback items below
    finance_costs: float = 0.0
    addbacks: AddBacks = field(default_factory=AddBacks)
    capital_allowances: float = 0.0  # from capital_allowances.py, or entered directly


def compute_accounting_pbt(tb: TrialBalanceLine) -> float:
    """Profit before tax, per the accounts, before any tax adjustment."""
    pbt = (
        _d(tb.turnover)
        - _d(tb.cost_of_sales)
        - _d(tb.salaries)
        - _d(tb.other_operating_expenses)
        - _d(tb.finance_costs)
    )
    return float(pbt)


def compute_deductible_other_expenses(tb: TrialBalanceLine) -> float:
    """
    Returns the tax-deductible replacement for `other_operating_expenses`,
    net of the disallowed items it contains, PLUS finance costs (which are
    deductible and have no separate slot in CurrencyExpenses).

    Feed this into CurrencyExpenses.other_expenses. Do not also pass the
    raw other_operating_expenses figure - that would deduct the disallowed
    items a second time.
    """
    addback_total = _d(tb.addbacks.total())
    net_other = _d(tb.other_operating_expenses) - addback_total
    if net_other < 0:
        raise ValueError(
            "addbacks.total() exceeds other_operating_expenses - addbacks must be "
            "a subset already booked inside other_operating_expenses, not additional to it. "
            f"other_operating_expenses={tb.other_operating_expenses}, "
            f"addbacks_total={float(addback_total)}"
        )
    return _money(net_other + _d(tb.finance_costs))


def to_currency_expenses(tb: TrialBalanceLine):
    """
    Convenience constructor: builds a calculator.CurrencyExpenses from a raw
    TrialBalanceLine, applying the add-back reconciliation above. Turnover
    is NOT part of CurrencyExpenses (it's QpdInput.usd_sales/zig_sales) -
    pass tb.turnover to QpdInput separately.
    """
    from .calculator import CurrencyExpenses  # local import avoids a cycle at module load

    return CurrencyExpenses(
        cost_of_sales=tb.cost_of_sales,
        salaries=tb.salaries,
        other_expenses=compute_deductible_other_expenses(tb),
        capital_allowances=tb.capital_allowances,
    )

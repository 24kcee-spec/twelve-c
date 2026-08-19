"""
ZIMRA capital allowances (statutory "tax depreciation") - optional helper.

CurrencyExpenses.capital_allowances (in calculator.py) stays a plain
pre-computed number by design - the reconciled ITF12C core is untouched.
This module is a standalone calculator for THAT number: work out an
asset register once with these helpers, then plug the total into
CurrencyExpenses.capital_allowances yourself. Nothing here is wired
into calculate_qpd() automatically.

Rates below are the standard framework under the Income Tax Act
(Twenty-Third Schedule) as commonly applied by ZIMRA:
- Special Initial Allowance (SIA): 25% of cost per year for 4 years,
  straight-line, on qualifying NEW industrial/commercial capital
  expenditure. Must be elected in the year of acquisition; once elected,
  wear & tear does not also apply to that asset for those 4 years.
- Wear & Tear (straight-line, applies when SIA is not elected):
    * Commercial buildings:            2.5%
    * Industrial / farm buildings:     5.0%
    * Motor vehicles:                  20.0%
    * Machinery & other movable assets: 10.0%

Re-verify these rates against the current Finance Act / ZIMRA public
notices at the start of each tax year - they change by budget, exactly
like the corporate tax rate and AIDS levy rate in calculator.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum

from .calculator import _d, _money  # reuse the same Decimal-safe helpers


class AssetCategory(str, Enum):
    COMMERCIAL_BUILDING = "commercial_building"
    INDUSTRIAL_FARM_BUILDING = "industrial_farm_building"
    MOTOR_VEHICLE = "motor_vehicle"
    MACHINERY_OTHER = "machinery_other"


WEAR_AND_TEAR_RATES: dict[AssetCategory, Decimal] = {
    AssetCategory.COMMERCIAL_BUILDING: Decimal("0.025"),
    AssetCategory.INDUSTRIAL_FARM_BUILDING: Decimal("0.05"),
    AssetCategory.MOTOR_VEHICLE: Decimal("0.20"),
    AssetCategory.MACHINERY_OTHER: Decimal("0.10"),
}

SIA_RATE = Decimal("0.25")
SIA_YEARS = 4


@dataclass
class CapitalAsset:
    """One fixed asset being claimed against, for one tax year's calculation."""

    description: str
    category: AssetCategory
    cost: float
    year_acquired: int
    elect_sia: bool = False  # only meaningful for NEW industrial/commercial assets


def compute_capital_allowance(asset: CapitalAsset, tax_year: int) -> float:
    """
    Capital allowance claimable on ONE asset for ONE tax year.

    SIA path: 25% of cost in each of the 4 years starting the year of
    acquisition, then 0 thereafter (fully written off).

    Wear & tear path: a flat rate of cost per year from acquisition
    onward, but never claims more in total than the asset's cost (stops
    once cumulative claims reach 100% of cost). Does not model a
    scrapping allowance/recoupment on disposal - that's a separate,
    disposal-triggered adjustment outside this function's scope.
    """
    years_since_acquisition = tax_year - asset.year_acquired
    if years_since_acquisition < 0:
        return 0.0  # asset doesn't exist yet in this tax year

    cost = _d(asset.cost)
    if cost <= 0:
        return 0.0

    if asset.elect_sia:
        if years_since_acquisition < SIA_YEARS:
            return _money(cost * SIA_RATE)
        return 0.0

    rate = WEAR_AND_TEAR_RATES[asset.category]
    already_claimed = cost * rate * Decimal(years_since_acquisition)
    if already_claimed >= cost:
        return 0.0
    remaining = cost - already_claimed
    this_year = cost * rate
    return _money(this_year if this_year <= remaining else remaining)


def compute_total_capital_allowances(assets: list[CapitalAsset], tax_year: int) -> float:
    """Sum of compute_capital_allowance() across a full asset register for one tax year."""
    total = Decimal("0")
    for asset in assets:
        total += _d(compute_capital_allowance(asset, tax_year))
    return float(total)

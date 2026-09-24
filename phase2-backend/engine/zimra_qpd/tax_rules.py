"""
Versioned ZIMRA tax-rule registry used by the Twelve C calculation engine.

This module is deliberately data-first. Tax-year-specific rules live here
instead of being repeated inside calculator.py, exports, or UI assumptions.

The registry records:
- corporate tax rate
- AIDS levy rate
- QPD instalment percentages
- QPD payment dates
- verified return dates where an official notice has been checked
- currency-treatment rule
- official source URLs
- verification metadata

A rule set is immutable from the application's point of view. To support a
new tax year, add a new TaxRuleSet entry after checking the official ZIMRA
source material. Do not silently overwrite an older year's rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Mapping


@dataclass(frozen=True)
class QpdRule:
    quarter: int
    installment_percentage: Decimal
    payment_date: str
    return_date: str | None = None


@dataclass(frozen=True)
class TaxRuleSet:
    tax_year: int
    effective_from: date
    effective_to: date
    corporate_tax_rate: Decimal
    aids_levy_rate: Decimal
    qpd_rules: Mapping[int, QpdRule]
    foreign_currency_threshold: Decimal
    foreign_currency_rule: str
    exchange_rate_source: str
    source_urls: tuple[str, ...]
    verified_at: date
    verification_basis: str
    notes: str = ""

    @property
    def qpd_cumulative_percentages(self) -> dict[int, Decimal]:
        cumulative = Decimal("0")
        result: dict[int, Decimal] = {}
        for quarter in (1, 2, 3, 4):
            rule = self.qpd_rules[quarter]
            cumulative += rule.installment_percentage
            result[quarter] = cumulative
        return result

    @property
    def qpd_payment_dates(self) -> dict[int, str]:
        return {q: rule.payment_date for q, rule in self.qpd_rules.items()}

    @property
    def qpd_return_dates(self) -> dict[int, str | None]:
        return {q: rule.return_date for q, rule in self.qpd_rules.items()}


# Official ZIMRA material reviewed 23 September 2026.
#
# 2026:
# - corporate tax = 25%
# - AIDS levy = 3% of tax chargeable
# - QPD payment percentages = 10/25/30/35
# - standard payment dates = 25 Mar / 25 Jun / 25 Sep / 20 Dec
# - Public Notice 36 of 2026 specifically confirms Q2 return 20 June
#   and payment 25 June.
# - The same notice states >50% foreign-currency estimated income uses
#   the 50/50 basis; <=50% uses currency of trade.
#
# We intentionally leave Q1/Q3/Q4 return_date as None because this registry
# must not manufacture dates that were not individually verified.
TAX_RULES_2026 = TaxRuleSet(
    tax_year=2026,
    effective_from=date(2026, 1, 1),
    effective_to=date(2026, 12, 31),
    corporate_tax_rate=Decimal("0.25"),
    aids_levy_rate=Decimal("0.03"),
    qpd_rules={
        1: QpdRule(1, Decimal("0.10"), "25 March"),
        2: QpdRule(2, Decimal("0.25"), "25 June", "20 June"),
        3: QpdRule(3, Decimal("0.30"), "25 September"),
        4: QpdRule(4, Decimal("0.35"), "20 December"),
    },
    foreign_currency_threshold=Decimal("0.50"),
    foreign_currency_rule=(
        "If estimated total income is more than 50% foreign currency, "
        "apply the 50/50 basis; at 50% or less, account in the currency of trade."
    ),
    exchange_rate_source=(
        "ZIMRA Domestic Taxes Exchange Rates â€” 2026 QPD exchange average rates. "
        "The applicable rate must be supplied for the relevant tax period."
    ),
    source_urls=(
        "https://www.zimra.co.zw/domestic-taxes/corporate/tax-rates",
        "https://www.zimra.co.zw/domestic-taxes/tax-payment-dates",
        "https://www.zimra.co.zw/frequently-asked-questions/1947-how-do-you-calculate-amounts-paid-on-quarterly-payment-dates-qpd",
        "https://www.zimra.co.zw/public-notices",
        "https://www.zimra.co.zw/domestic-taxes/2023-tax-years-average-auction-exchange-rates/2026",
    ),
    verified_at=date(2026, 9, 23),
    verification_basis="Official ZIMRA webpages and Public Notice 36 of 2026 reviewed by Twelve C engineering.",
    notes=(
        "This is a software rule registry, not a ZIMRA certification. "
        "Re-verify before enabling a new tax year."
    ),
)


# 2025 keeps the standard ZIMRA published QPD schedule so historical
# calculations remain deterministic. Year-specific exceptions should be added
# here when supported by an official notice rather than silently borrowing 2026.
TAX_RULES_2025 = TaxRuleSet(
    tax_year=2025,
    effective_from=date(2025, 1, 1),
    effective_to=date(2025, 12, 31),
    corporate_tax_rate=Decimal("0.25"),
    aids_levy_rate=Decimal("0.03"),
    qpd_rules={
        1: QpdRule(1, Decimal("0.10"), "25 March"),
        2: QpdRule(2, Decimal("0.25"), "25 June"),
        3: QpdRule(3, Decimal("0.30"), "25 September"),
        4: QpdRule(4, Decimal("0.35"), "20 December"),
    },
    foreign_currency_threshold=Decimal("0.50"),
    foreign_currency_rule=(
        "For the standard registry rule: a foreign-currency-dominant estimate "
        "uses the 50/50 basis; otherwise use the currency-of-trade ratio."
    ),
    exchange_rate_source=(
        "Applicable ZIMRA tax-period exchange-rate publication; "
        "the actual rate must be supplied by the caller."
    ),
    source_urls=(
        "https://www.zimra.co.zw/domestic-taxes/tax-payment-dates",
        "https://www.zimra.co.zw/domestic-taxes/corporate/tax-rates",
        "https://www.zimra.co.zw/frequently-asked-questions/1947-how-do-you-calculate-amounts-paid-on-quarterly-payment-dates-qpd",
    ),
    verified_at=date(2026, 9, 23),
    verification_basis="Official ZIMRA standard QPD schedule and current corporate tax-rate page; historical year-specific notices still require review.",
    notes=(
        "Historical compatibility rule. Do not treat this as proof that no "
        "2025 year-specific notice changed a date."
    ),
)


TAX_RULE_REGISTRY: Mapping[int, TaxRuleSet] = {
    2025: TAX_RULES_2025,
    2026: TAX_RULES_2026,
}


class TaxRuleNotFoundError(ValueError):
    """Raised when Twelve C has no verified rule set for a requested tax year."""


def get_tax_rules(tax_year: int) -> TaxRuleSet:
    try:
        return TAX_RULE_REGISTRY[int(tax_year)]
    except (KeyError, TypeError, ValueError) as exc:
        supported = ", ".join(str(y) for y in sorted(TAX_RULE_REGISTRY))
        raise TaxRuleNotFoundError(
            f"No tax rule set is configured for tax year {tax_year}. "
            f"Configured tax years: {supported}. Add and verify the year's "
            f"official ZIMRA rules before calculating."
        ) from exc


# Backwards-compatible names for code that still imports these constants.
# They point to the registry, so the old names are no longer independent
# sources of tax truth.
DEFAULT_TAX_RULES = TAX_RULES_2026
QUARTER_CUMULATIVE_PERCENTAGE = DEFAULT_TAX_RULES.qpd_cumulative_percentages
QUARTER_DUE_DATES = DEFAULT_TAX_RULES.qpd_payment_dates
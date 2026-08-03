"""Quick usage example - run with: python demo.py"""

from zimra_qpd import CurrencyExpenses, QpdInput, calculate_qpd

business = QpdInput(
    usd_sales=12000,
    zig_sales=0,
    usd_expenses=CurrencyExpenses(salaries=3000, other_expenses=8900),
    zig_expenses=CurrencyExpenses(),
    exchange_rate=26.8,
)

result = calculate_qpd(business)

print(f"USD trade ratio:      {result.usd_ratio:.0%}")
print(f"Payment ratio (USD):  {result.payment_ratio_usd:.0%}  (capped at 50% - USD is dominant)")
print(f"Taxable profit:       USD {result.taxable_profit_usd:,.2f}  /  ZIG {result.taxable_profit_zig:,.2f}")
print(f"Total annual tax:     USD {result.total_tax_usd:,.2f}  /  ZIG {result.total_tax_zig:,.2f}")
print()
print("QPD schedule:")
for instalment in result.schedule:
    print(f"  {instalment.label:<20} {instalment.percentage:>4.0%}   USD {instalment.usd:>8,.2f}   ZIG {instalment.zig:>10,.2f}")

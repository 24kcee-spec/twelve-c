# zimra-qpd

Python engine for Zimbabwe's Quarterly Payment Date (QPD) provisional tax calculation, ported from the ITF12C 2025 master sheet logic in the source Excel workbook.

## What this fixes vs the original spreadsheet

- The QPD schedule no longer depends on a dead cell reference (`E33`) that silently returned zero.
- Payment tracking (`apply_payments()`) actually computes balances - the original "QPD Payments Made" rows referenced blank cells and never worked.
- Tax rate and AIDS levy rate are parameters, not hardcoded numbers, so a future ZIMRA rate change is a config value, not a code change.

## Install

```
pip install -e .
```

## Usage

```python
from zimra_qpd import CurrencyExpenses, QpdInput, calculate_qpd

business = QpdInput(
    usd_sales=12000,
    zig_sales=0,
    usd_expenses=CurrencyExpenses(salaries=3000, other_expenses=8900),
    zig_expenses=CurrencyExpenses(),
    exchange_rate=26.8,
)

result = calculate_qpd(business)
print(result.total_tax_usd, result.total_tax_zig)
for instalment in result.schedule:
    print(instalment.label, instalment.usd, instalment.zig)
```

Run `python demo.py` for a worked example, or `python -m pytest tests/ -v` to see it validated against the exact figures from the source workbook (13 tests, all currently passing).

## Verified rates

Corporate tax 25% + 3% AIDS levy on the tax payable (25.75% effective) - confirmed current as of 2026 against ZIMRA/Trading Economics/Chambers Global Practice Guide sources. Both rates are constructor arguments on `QpdInput`, defaulting to the current values.

## Next steps

This engine is Phase 1 of the full build (see the blueprint doc). It's a pure calculation library with no I/O, no network calls, no storage - ready to be dropped behind a FastAPI backend in Phase 2.

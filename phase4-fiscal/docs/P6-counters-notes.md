# P6 notes - fiscal-day counters (2 Oct 2026)

Module: `phase4-fiscal/src/fiscal_core/counters.py` (pure, no I/O). Tests: `tests/test_counters.py` (68 new). One-line fix in `canonicalise.py` (see "Bug fixed").

## Rules implemented (spec section 6, read in full)
| Receipt type | Counters updated |
|---|---|
| FiscalInvoice | SaleByTax += salesAmountWithTax; SaleTaxByTax += taxAmount (per receiptTaxes entry) |
| CreditNote | CreditNoteByTax, CreditNoteTaxByTax (same fields; amounts are NEGATIVE as sent) |
| DebitNote | DebitNoteByTax, DebitNoteTaxByTax |
| all three | BalanceByMoneyType += paymentAmount (per receiptPayments entry) |
- Amounts are added as sent; discount lines are already netted into receiptTaxes ("after discount"), so only `receiptTaxes` and `receiptPayments` are read.
- Per currency: USD and ZiG are never netted. Counters are per fiscal day.
- Zero counters are tracked but omitted from the closeDay request (spec 4.11).
- A receipt that disagrees with itself is refused, not counted: payment sign (RCPT028), receiptTotal vs sum of sales (RCPT038) and vs sum of payments (RCPT039), total sign (RCPT040). Validation happens before any counter changes, so a bad receipt changes nothing.

## Ledger is the source of truth
- `rebuild_day(receipts, day)` / `counters_for_day(store, device, day)` recompute counters from stored receipts. ONLY ACCEPTED receipts count; REJECTED (422) are excluded; anything unresolved makes `ready_to_close` False.
- `report.last_receipt_counter` = value for closeDay.receiptCounter (the day's last number, rejected numbers included).
- `FiscalDayCounters.from_wire(getStatus counters)` + `diff_counters(ledger, server)` shows exactly which counter disagrees. A non-empty diff must be investigated before closing a day.
- `to_wire()` feeds `FdmsClient.close_day`; `to_canonical()` feeds `canonicalise.build_fiscal_day_signing_string`. Tested: counters built from receipts reproduce the spec 13.3.1 example signing-string tail.

## Bug fixed in passing (canonicalise.py)
`MONEY_TYPE_ORDER` only knew Cash, Card, MobileWallet. Spec 5.4.5 has 7 money types (adds Coupon 3, Credit 4, BankTransfer 5, Other 6). A day containing any of those would have built valid counters and then FAILED at signing. Fixed (one line); the existing canonicalise tests still pass and a new test sorts all 7.

## HONEST LIMITS / OPEN QUESTIONS
1. **S10**: does FDMS count a receipt it ACCEPTED but flagged "Red"? Red receipts block closeDay anyway, so it matters only once such a receipt exists. Settle in P13.
2. **S2 (still open)**: cross-type counter ordering in the signing string is implemented as the spec enum order (SaleByTax ... BalanceByMoneyType), matching the spec example, but the example only exercises SaleByTax, SaleTaxByTax and BalanceByMoneyType. Credit/debit counter positions are unproven against FDMS until P13.
3. Wire representation of enums (names vs numbers) is unverified; to_wire() emits names, from_wire() accepts both.
4. The simulator does NOT compute counters from submitted receipts, so a real CountersMismatch cannot be produced by it yet; its close outcome is a switch. Worth adding before P9/P13.
5. Tax-group identity is (taxID, taxPercent). If FDMS keys by taxID alone, two groups sharing an ID with different percents would merge there but not here; unlikely, verify in P13.
6. No rounding is done here: amounts must already be whole cents (Decimal(21,2)); anything else is refused.

## Not done here
Preflight rules P7 (RCPT010-RCPT048; this module only enforces the few that protect counter integrity); receipt builder/signing P8; close-day orchestration P9 (`counters_for_day` + `build_fiscal_day_signing_string` + `close_day`).

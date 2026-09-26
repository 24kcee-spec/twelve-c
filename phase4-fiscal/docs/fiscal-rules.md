# Fiscal Rules — distilled from ZIMRA Fiscal Device Gateway API Spec v7.2

Living reference. Feed **only this file** into a session working on business logic
(state machine, counters, validation) — not the full spec PDF. Update this file,
not the raw spec, when rules are clarified or change.

**Spec version confirmed current**: v7.2, verified live at
`zimra.co.zw/downloads` on 25 Sep 2026 (see `decisions.md`).

---

## 1. Fiscal day state machine

```
FiscalDayClosed --(openDay)--> FiscalDayOpened
FiscalDayOpened --(closeDay, no Grey/Red receipts, validation passes)--> FiscalDayClosed
FiscalDayOpened --(closeDay, validation fails)--> FiscalDayCloseFailed
FiscalDayCloseFailed --(closeDay retry)--> FiscalDayClosed | FiscalDayCloseFailed
```

Between `closeDay` request and FDMS validation result, status is briefly
`FiscalDayCloseInitiated` — no new close request or new invoice accepted in that
window.

Hard rules:
- New fiscal day only opens from `FiscalDayClosed`.
- Receipts only accepted when status is `FiscalDayOpened` or `FiscalDayCloseFailed`.
- `fiscalDayNo` must be `1` for the device's first day, else exactly one more than
  the last **closed** day's number.
- `receiptCounter` resets to 0 on close, restarts at 1 each new day.
- `receiptGlobalNo` never resets except deliberately, and only via the first
  receipt of a new fiscal day.
- Day cannot close automatically while any receipt is "Grey" (broken chain,
  missing predecessor) or "Red" (hard validation failure) — see §4.
- Max fiscal day duration is `taxPayerDayMaxHrs` (from `getConfig`); device must
  warn the user `taxpayerDayEndNotificationHrs` before that limit and must not
  allow new receipts past it.

## 2. Receipt lifecycle

1. Local preflight validation **before burning a receipt number** — a
   `receiptGlobalNo`/`receiptCounter` is consumed on submission whether FDMS
   accepts or rejects, so validate everything checkable client-side first.
2. Receipt signed by device (ECDSA-secp256r1 or RSA-2048), submitted to
   `submitReceipt`.
3. FDMS returns its own signature (`receiptServerSignature`) — an
   acknowledgement, **not** the QR code. Idempotent: resubmitting the identical
   `(deviceID, receiptGlobalNo, receiptHash)` returns the same `receiptID` and
   signature with a new `operationID`, never a duplicate.
4. Receipts must be submitted **one at a time, strictly ascending
   `receiptGlobalNo`**, never skipped, never reordered.

## 3. Sequencing rules (the ones that bite)

- `receiptCounter`: 1 for the first receipt of the day, then strictly +1.
- `receiptGlobalNo`: strictly +1 from the previous receipt overall (device
  lifetime), or may restart at 1 **only** as the first receipt of a new fiscal
  day, and only if the taxpayer deliberately chose to reset it.
- `receiptDate` must be: after the fiscal day's opening time; strictly later
  than the previous receipt's date; not later than "now" (small allowed skew);
  not later than `fiscalDayOpened + taxPayerDayMaxHrs`.
- `invoiceNo` (the accounting system's own number) must be unique per taxpayer,
  forever — this is your app's number, distinct from `receiptGlobalNo`.

## 4. Validation severity (Grey / Yellow / Red)

| Color | Meaning | Blocks auto-close? |
|---|---|---|
| Grey | Chain gap — previous receipt missing. Re-validated as later receipts arrive; can resolve itself. | Yes |
| Yellow | Minor issue (e.g. future-dated receipt, receipt predates day open). | No |
| Red | Hard validation failure (bad signature, bad totals, wrong currency, etc.). | Yes |

A day with only Yellow issues can still close automatically. Grey or Red means
manual intervention (fix and resubmit, or ZIMRA officer / Public Portal manual
close) is required.

**UI rule (carried from Phase 6 of the build plan): never present an advisory
(Yellow) as if it were a rejection.** That's a named trust-eroding mistake in
the guide.

## 5. Credit / debit notes — "the part most implementations get wrong"

- Must reference an existing receipt (`receiptID`, or the trio
  `deviceID`+`receiptGlobalNo`+`fiscalDayNo`).
- Referenced receipt must belong to the same taxpayer.
- Referenced receipt must be no more than **12 months** old at the note's date.
- Same currency as the original invoice — never mixed.
- Total credit notes issued against a receipt can't push
  `original amount − prior credit notes + prior debit notes` below zero.
- Tax lines on the note must be a subset of the tax lines on the original
  invoice — no introducing a tax type that wasn't on the original.
- `receiptNotes` (a free-text explanation) is mandatory for CreditNote/DebitNote.

## 6. Currency handling

- USD and ZiG (ZWG) are **never netted or offset against each other** — same
  no-cross-currency-offsetting principle as Twelve C's own QPD Section 37AA
  rule. Every counter, every compliance check, every total is kept per-currency.
- Standard VAT rate in current ZIMRA guidance: **15.5%** (per-tax-type;
  confirm current value via `getConfig`'s `applicableTaxes` at integration
  time — don't hardcode). This is a **different tax** from Twelve C's own
  25.75% QPD (income tax) rate — never conflate the two in code, docs, or UI copy.

## 7. Fiscal counters (reset every fiscal day close)

Per tax, per currency (and `BalanceByMoneyType` also per payment method):

- `SaleByTax`, `SaleTaxByTax` — fiscal invoices only, sales after discount.
- `CreditNoteByTax`, `CreditNoteTaxByTax` — credit notes (recorded as negative
  adjustments to the running total unless the note itself is a discount line).
- `DebitNoteByTax`, `DebitNoteTaxByTax` — debit notes (additive).
- `BalanceByMoneyType` — money actually collected/paid, by payment method and
  currency.

Zero-value counters are omitted from `closeDay`/`submitFile` payloads, not sent
as zero.

## 8. Offline mode essentials

- Device may operate without a live connection; `openDay`, `submitReceipt`
  effects still happen locally in strict order, batched later via `submitFile`.
- `submitFile` payload order is fixed: Header (mandatory) → Content (optional)
  → Footer (optional) — Footer only in the final file for a fiscal day.
- A file is capped at 3 MB; split larger days into sequential files, never
  splitting the Footer across files.
- Reconciliation: for any receipt whose outcome is unknown after a network
  failure, **explicitly check its status** (`getFileStatus`/`getStatus`) rather
  than blindly retrying — named failure mode in the build plan (§5.7),
  because blind retry risks either a duplicate or a silently skipped number.

## 9. Certificates as security principals

- Two supported key types: ECC secp256r1 (preferred) or RSA-2048.
- CSR subject `CN` must be
  `ZIMRA-<Fiscal_device_serial_no>-<zero_padded_10_digit_deviceId>`; if other
  Subject fields are present they must match `C=ZW`, `O=Zimbabwe Revenue
  Authority`, `S=Zimbabwe` exactly or registration is rejected.
- 401 causes (Section 7.3, exactly four): cert not issued by the gateway;
  cert revoked; cert expired; cert not issued to the calling `deviceID`.
- Renew before expiry — recommended a month ahead; renewal doesn't depend on
  fiscal day status, but doing it before opening a new day is recommended.

## 10. Do not conflate with QPD

This is a different regulatory system from Twelve C's QPD engine:

| | QPD | Fiscalisation (FDMS) |
|---|---|---|
| Tax type | Income tax (provisional) | VAT, per-transaction |
| Cadence | Quarterly | Real-time, per receipt |
| Rate | 25.75% (25% corp + 3% AIDS levy) | 15.5% VAT (verify current) |
| Currency rule | USD/ZiG never netted (Section 37AA) | USD/ZiG never netted (same principle, different section) |

Both systems independently enforce no-cross-currency-netting — that's a
genuine ZIMRA-wide pattern, not a coincidence, and worth keeping consistent
in how both phases present it to the user.


## 13. Signature generation (device + FDMS, receipt + fiscal day)

Full detail and worked examples: spec PDF pages 71-77. Implementation:
`fiscal_core/canonicalise.py`. Algorithm (13.1): concatenate fields as
strings (no separator) → SHA-256 → sign the hash (RSA or ECC per device
key type). canonicalise.py stops at the concatenated string; hashing and
signing is crypto.py's job (Phase 2).

**Shared formatting rules** used everywhere a percent or an amount appears
in a signing string:
- Amounts (`receiptTotal`, `taxAmount`, `salesAmountWithTax`,
  `fiscalCounterValue`) are in **cents**, sign preserved, no decimal point.
- A tax/counter percent: absent/exempt → empty string; otherwise always
  exactly 2 decimal places (`15` → `"15.00"`, `14.5` → `"14.50"`).
- `receiptType`/`receiptCurrency`/counter names are upper-cased.
- Dates: `YYYY-MM-DDTHH:mm:ss` (receipt-level, local time) or `YYYY-MM-DD`
  (fiscal-day-level).

**Receipt device signature (13.2.1)**: `deviceID || receiptType ||
receiptCurrency || receiptGlobalNo || receiptDate || receiptTotal(cents) ||
receiptTaxes || previousReceiptHash`. `receiptTaxes` = each tax line's
`taxCode || taxPercent || taxAmount || salesAmountWithTax`, concatenated
after sorting by taxID ascending then taxCode alphabetically (empty code
sorts first). `previousReceiptHash` is **omitted entirely** for the first
receipt of a fiscal day.

**Receipt FDMS signature (13.2.2)**: `receiptDeviceSignature || receiptID
|| serverDate`. Only generated for "Online" mode receipts.

**Fiscal day device signature (13.3.1)**: `deviceID || fiscalDayNo ||
fiscalDayDate || fiscalDayCounters`. `fiscalDayCounters` = each non-zero
counter's `counterType || currency || (taxPercent or moneyType) ||
value(cents)`, concatenated. **Open item**: the ordering ACROSS different
counter types (e.g. SaleByTax vs BalanceByMoneyType) is not confirmed —
see `decisions.md` 2026-09-26 (session 4). Ordering WITHIN one type
(currency, then percent/moneytype) is confirmed.

**Fiscal day FDMS signature (13.3.2)**: `deviceID || fiscalDayNo ||
fiscalDayDate || fiscalDayUpdated || reconciliationMode || fiscalDayCounters
|| fiscalDayDeviceSignature`. The trailing device signature is **omitted**
when `reconciliationMode` is `MANUAL` (included for `AUTO`).

**QR code (Section 11)**: `qrUrl + deviceID(10, zero-padded) +
receiptDate(ddMMyyyy) + receiptGlobalNo(10, zero-padded) +
receiptQrData(first 16 hex chars of MD5 of the device signature)`.
Note this uses **different** field widths/padding than the signing
strings above (e.g. deviceID zero-padded to 10 digits here, but bare in
the signing string) — don't reuse one formatter for both.

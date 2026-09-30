# P1 - Spec lock-in (checked 29 Sep 2026)

Sources: ZIMRA Fiscal Device Gateway API v7.2 (77 pages, read directly), ZIMRA news "Compliance with the ZIMRA FDMS", Public Notices 63/2025, 37/2026, ZIMRA downloads page. Planning notes, not legal or tax advice.

## 1. Version and notice check

| Question | Finding |
|---|---|
| Is there a spec newer than v7.2? | **No evidence of one.** ZIMRA's "Fiscalisation API Documentation" download still serves v7.2. No v8 found. Re-check at the start of P13 and P19. |
| TARMS-FDMS cut-off | PN 63/2025: cut-off **1 Dec 2025** for valid fiscal tax invoices, debit notes received and credit notes issued. Input tax data now flows FDMS -> TaRMS for VAT returns due 10 Jan 2026 onward. Compliance is also a condition for a tax clearance certificate (ITF263). (The earlier plan said 31 Dec 2025; 1 Dec is correct.) |
| Any later change to the mandate? | None found. PN 37/2026 (16 Jun 2026) is operational only: new regional FDMS support emails. PN 26/2024 covers Virtual Fiscalisation and API FDMS. PN 05/2026 (digital services) requires non-resident VAT suppliers to be onboarded to FDMS. |
| Onboarding route for a software (virtual) device | See section 2 and docs/P1-X-zimra-onboarding.md |
| Verification URL | **Inconsistent inside ZIMRA material:** spec section 10 templates print `https://receipt.zimra.org/`; spec section 11 QR config lists `qrUrl` = `https://invoice.zimra.co.zw`; ZIMRA's news page says scan-verify at `https://fdms.zimra.co.zw`. Treat the URL as **configuration**, confirm on the test environment (feeds P13). |

## 2. ZIMRA's own onboarding steps for virtual fiscalisation (Option B)
1. Download the API document.
2. Build the API interface (us).
3. Email the regional FDMS support address asking for **test-environment registration and endpoint details**.
4. Run API tests on the FDMS test platform.
5. Generate sample invoice, credit note and debit note in the test environment.
6. Close the fiscal day with **no errors**.
7. Submit the samples to ZIMRA for approval.
8. After approval, ZIMRA registers the device on the **live** environment.

Consequence for the roadmap: P13 (test campaign) and P19 (approval) are the same evidence trail. Steps 5-6 must be repeatable from a script.

## 3. Distilled spec facts (new in P1)

### 3.1 Device requirements (spec section 9) - the acceptance checklist
1. Open a fiscal day before issuing any receipt.
2. With internet, call getConfig before opening a day.
3. Persist getConfig taxpayer/branch data and use it on printed documents.
4. Track time since day opened; **block new receipts after `taxPayerDayMaxHrs`**.
5. Warn the user `taxpayerDayEndNotificationHrs` before that limit.
6. `receiptGlobalNo`: sequential from 1, **continues across days**.
7. It may be reset only by making it the first receipt of a new fiscal day.
8. `receiptCounter`: sequential from 1 **within** a day, reset after close.
9. If the taxpayer has no VAT number, forbid VAT-taxed lines. If a VAT number appears mid-day, block issuing until the day is closed.
10. Day-open message is sent immediately, may be delayed offline, but **before any receipt**.
11. Receipts go only after a successful day open.
12. Send a receipt only after it is finished (printed).
13. Send **one by one in ascending `receiptGlobalNo`, skipping none**. On failure, fix and resubmit.
14. Send immediately if online and nothing is queued; otherwise queue.
15. Update counters per section 6; reset on new day.
16. Renew the certificate before it expires.
17. Offline file: one closed fiscal day only.
18. File over 3 MB: split the content; the footer cannot be split.
19. Large days: recommend receipts and Z report in separate files.
20. Multiple files for a day: send in sequence.
21. Offline devices must export a file for manual upload to FDMS Self-service.
22. Never uninstall while unsent invoices exist.

### 3.2 Enums (section 5.4) - exact values and order
- DeviceOperatingMode: Online 0, Offline 1
- FiscalDayStatus: Closed 0, Opened 1, CloseInitiated 2, CloseFailed 3
- FiscalDayReconciliationMode: Auto 0, Manual 1
- **FiscalCounterType: SaleByTax 0, SaleTaxByTax 1, CreditNoteByTax 2, CreditNoteTaxByTax 3, DebitNoteByTax 4, DebitNoteTaxByTax 5, BalanceByMoneyType 6** (this closes the open question in the Phase 4 canonicalisation handover: the enum gives the cross-type order 0..6; whether the signing string sorts by this order is still to be checked against section 13, see the note in docs/decisions.md)
- MoneyType: Cash 0, Card 1, MobileWallet 2, Coupon 3, Credit 4, BankTransfer 5, Other 6
- ReceiptType: FiscalInvoice 0, CreditNote 1, DebitNote 2
- ReceiptLineType: Sale 0, Discount 1
- ReceiptPrintForm: Receipt48 0, InvoiceA4 1
- FiscalDayProcessingError (validated in this order): BadCertificateSignature 0, MissingReceipts 1 (Grey), ReceiptsWithValidationErrors 2 (Red), CountersMismatch 3
- FileProcessingStatus: InProgress 0, IsSuccessful 1, WithErrors 2, WaitingForPreviousFile 3
- FileProcessingError: IncorrectFileFormat 0, FileSentForClosedDay 1, BadCertificateSignature 2, MissingReceipts 3, ReceiptsWithValidationErrors 4, CountersMismatch 5, FileExceededAllowedWaitingTime 6
- UserStatus: Active 0, Blocked 1, NotConfirmed 2. SendSecurityCodeTo: Email 0, PhoneNumber 1

### 3.3 Shared types (5.1-5.3)
- Address: province, city, street, houseNo - all String(100), all mandatory.
- Contacts: phoneNo String(20), email String(100); **at least one** required.
- SignatureData: hash (32 bytes, SHA-256), signature (variable length by algorithm). SignatureDataEx adds certificateThumbprint (20 bytes, SHA-1).

### 3.4 Offline batch: submitFile / getFileStatus (4.9, 4.10)
- Allowed **only when DeviceOperatingMode = Offline** (openDay and closeDay are Online-only, else DEV01).
- File = JSON, sent as base64. Parts in fixed order: **header, content, footer**. Header mandatory; content and footer optional. Footer only in the **last** file of a day.
- One fiscal day per file; day must be **closed** on the device.
- Synchronous rejections: mode not Offline, over 3 MB (FILE01), bad structure, deviceID mismatch (FILE05), unparseable header, day already closed or closing (FILE04).
- Then processed **asynchronously**: structure, day status from header, receipts imported with the same rules as submitReceipt, then Z report validated.
- Content and footer are processed as separate parts. Content can succeed while the footer fails; if content fails, footer is skipped.
- **Idempotent:** an invoice is created only if (deviceID, fiscalDayNo, receiptGlobalNo, receiptHash) is new. Resending is safe.
- Two files with the same fiscalDayNo but different fiscalDayOpened: the first by sequence wins.
- Header: deviceID, fiscalDayNo, fiscalDayOpened (local time, no zone), fileSequence. Footer: fiscalCounters (zero counters omitted), fiscalDayDeviceSignature, receiptCounter, fiscalDayClosed.
- getFileStatus: input deviceID, optional operationID, fileUploadedFrom/Till (window **max 100 days**). Output per file: operationID, upload date, fileName, processing date, status, error codes, fiscalDayNo, fileSequence, ipAddress.

### 3.5 Printed document layouts (section 10)
Two forms, four templates: Receipt48 and InvoiceA4, each as invoice and credit/debit note (A4 also has tax-inclusive and tax-exclusive variants).
Mandatory content: taxpayer logo, legal name, TIN, VAT no., branch name/address/email/phone; document title (FISCAL TAX INVOICE / CREDIT NOTE / DEBIT NOTE); buyer name, trade name, TIN, VAT no., address, email, phone; `Invoice No: receiptCounter/receiptGlobalNo`, fiscal day no., customer reference, device serial, device ID, date-time; for credit/debit notes a "CREDITED/DEBITED INVOICE" block (original serial, global no., date, customer reference); lines (name, quantity @ unit price, line total, tax code); total in receipt currency and each payment method/amount; number of items; a **tax table per tax code** (net, tax %, tax, gross); free note; QR code; verification code formatted `XXXX-XXXX-XXXX-XXXX`; verification URL.
Note: the A4 tax-exclusive layout shows totals ex-tax, then VAT, then the total to pay.
Sample layouts contain internal inconsistencies (mixed decimal comma/point, "FICAL"), so treat them as layout guides, not test vectors. Z/X report field list is in spec 10.4-10.5 and is handled in P12.

## 4. Open items after P1
| # | Item | Blocked on | Phase |
|---|---|---|---|
| S1 | Test-environment access, TIN/VAT, deviceID, activation key | ZIMRA (email in P1-X doc) | P1-X |
| S2 | Confirm counter ordering in the fiscal-day signing string vs enum order | Section 13 re-read + test env | P13 |
| S3 | ECDSA encoding DER vs raw, QR MD5 input (F4, F8) | Test env | P13 |
| S4 | Which verification URL is live | Test env | P13 |
| S5 | Certificate-chain validation of FDMS signatures | getServerCertificate | P4 |
| S6 | Spec sections 4.13 (user management) and 4.15 (getStockList) not needed for v1; parked | - | later |

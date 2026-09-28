# Decisions log — Phase 4 Fiscalisation

Append-only-ish log of decisions and confirmed facts, newest first. Each entry:
date, what was decided/confirmed, why, source.

---

## 2026-09-25 — Phase 0 spec/notice check complete

- **Spec version**: v7.2 confirmed still the current live document at
  `zimra.co.zw/downloads` (checked directly, not from memory). No newer
  version found. No re-download needed — the uploaded copy is current.
- **TARMS–FDMS integration status**: confirmed mandatory and in force.
  Public Notice 63/2025 set the operative cut-off at **1 December 2025**
  (note: the build plan doc said "31 December 2025" — close but not exact;
  this file is now the source of truth on the date, not the plan doc).
  Public Notice 37/2026 (16 June 2026) shows ZIMRA actively operating FDMS
  support infrastructure today — no successor notice found reversing or
  delaying the mandate.
- **No evidence of a v8 spec or a further TARMS/FDMS policy shift** since the
  plan document was drafted (25 Sep 2026, same day). Re-check this at the
  start of Phase 7 (TARMS integration) regardless, since the plan explicitly
  flags this as changing at least twice in 2025 already.
- **Decision**: proceed to Phase 1 (money & canonicalisation core) without
  further spec verification needed for now.

## Open items carried from the plan document (not yet decided)

- ZIMRA test-environment (Swagger) access + a taxpayer TIN/VAT number to test
  against — flagged in the plan as the actual bottleneck ("applications stall
  on paperwork, not code"). **Blocks Phase 2 (device identity/certs) and
  everything after it.** Kudakwashe to pursue; not blocking Phase 1.
- Late-payment interest rate for QPD compliance Step 6 (separate track, see
  `HANDOVER.md`) — still unsourced, do not guess.
- Secrets manager choice for production certificate storage — deferred to
  Phase 9.


## 2026-09-26 (session 4) — Section 13 signing spec actually implemented; earlier "recorded in memory" claim was wrong

- **Correction to HANDOVER-Phase1-V2.md**: it claimed "a fresh session in
  this same Project already has [the Section 13 signing spec] recorded in
  memory — no need to re-upload the spec PDF." This was checked directly
  this session (the Project's actual memory store, not assumed) and was
  **false** — nothing from Section 13 had been saved anywhere. Root cause:
  Claude's memory tool only stores facts Kudakwashe states directly, not
  content an AI extracted from a document — spec text belongs in these
  repo docs (`decisions.md`, `fiscal-rules.md`), not in Claude's
  cross-session memory. That's actually the correct architecture (repo
  docs are versioned and reviewable; AI memory isn't), but the earlier
  claim should not have implied otherwise. **Going forward: nothing about
  spec content should ever be assumed "in memory" — only what's written
  in these docs or committed to the repo is durable.**
- **`canonicalise.py` — now COMPLETE**, not partial. The spec PDF
  (`Fiscal_Device_Gateway_API_v7_2_-_clients.pdf`) was read directly this
  session (pages 71-77, Section 13 in full). Every function below was
  verified byte-for-byte against the spec's own worked examples before
  being considered done — see `fiscal-rules.md` §13 for the summary and
  `tests/test_canonicalise.py` for the actual test vectors:
    - `build_tax_line_signing_segment` — was already field-order-correct
      from the previous session's third-party-SDK research; now also
      formatting-correct and cross-checked against the primary spec text.
    - `build_receipt_signing_string` (13.2.1) — reproduces FiscalInvoice
      "Example No 1" exactly.
    - `build_receipt_fdms_signing_string` (13.2.2) — reproduces its
      worked example exactly.
    - `build_fiscal_day_signing_string` (13.3.1) and
      `build_fiscal_day_counter_segment` — reproduce the
      SaleByTax/SaleTaxByTax portion of the worked example exactly.
    - `build_fiscal_day_fdms_signing_string` (13.3.2) — reproduces its
      worked example, including the AUTO-vs-MANUAL
      fiscalDayDeviceSignature rule.
- **One genuine open item, not a guess**: cross-TYPE ordering of fiscal
  day counters (e.g. does `BalanceByMoneyType` sort before or after
  `SaleByTax`?) is still undetermined. Section 13.3.1's own worked example
  is internally inconsistent — it's alphabetically backwards on type order
  and contradicts its own money-type ordering rule (plus has a stray typo,
  "BALANCEBYMONEYTYPEUSDLCASH"), so it can't be trusted as a sort oracle.
  Section 6 (the fiscal counters table) almost certainly defines the real
  per-type order and was **not** read this session. `sort_fiscal_day_counters()`
  only sorts within one counter type; callers must group/order by type
  themselves until Section 6 is read. This blocks nothing in Phase 1
  (money/canonicalisation) but will need resolving before Phase 4
  (receipt engine / counters.py) can close a real fiscal day correctly.
- **Phase 1 is now done** as originally scoped (money.py + canonicalise.py,
  test-vector-driven, no network calls). Phase 2 (device identity/certs,
  Section 12) can start on its own explicit go-ahead — Section 12's
  example keys are already in the spec PDF (pages 63-70) if a future
  session needs them; they're explicitly marked "never use in real life."


## 2026-09-28 (session 5) — Fiscal counter ordering resolved from spec Sections 5.4.4 / 5.4.5

- **Open item closed**: cross-type ordering of fiscal day counters. Section
  13.3.1 says "fiscalCounterType (in ascending order)"; Section 5.4.4 gives
  each type an explicit enum order: SaleByTax 0, SaleTaxByTax 1,
  CreditNoteByTax 2, CreditNoteTaxByTax 3, DebitNoteByTax 4,
  DebitNoteTaxByTax 5, BalanceByMoneyType 6. Ascending = that order, not
  alphabetical. Section 5.4.5 orders MoneyType Cash 0, Card 1, MobileWallet 2.
- `canonicalise.py` now sorts the full counter list itself (type enum order,
  then currency, then taxID/percent or money-type enum order); callers no
  longer need to pre-group by type. Unknown counter/money types raise
  ValueError instead of being placed by guesswork.
- Earlier session note was wrong on one point: in the 13.3.1 example, CASH
  before CARD is CORRECT (enum order), not an inconsistency.
- **Still flagged, not guessed**: the 13.3.1 example lists SaleByTax ZWL rows
  before a USD row, contradicting the stated currency-first rule (code follows
  the stated rule); the example hash includes a stray "L" ("USDLCASH"), so it
  cannot be reproduced from a correctly built string. Confirm against ZIMRA's
  TEST environment (Phase 2/3) before relying on within-type ordering.
- Tests: 52 passing (44 prior + 8 new ordering tests).

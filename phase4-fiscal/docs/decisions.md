# Decisions log — Phase 4 Fiscalisation

Append-only-ish log of decisions and confirmed facts, newest first. Each entry:
date, what was decided/confirmed, why, source.

---

## 2026-09-26 (session 3) — Phase 1 gate failure diagnosed and fixed (V3 script)

- **Root cause of the "12 errors in 1.96s" / "0 passed" phase4-fiscal gate
  failure, and almost certainly of phase1-engine's "7 errors" in the same
  run too**: pytest's default rootdir-recursive test discovery was also
  collecting every `test_money.py`/`test_canonicalise.py` copy sitting
  inside `_backups/<timestamp>/` — created automatically by the delivery
  script's own `Backup-IfExists` step on every run. By the 26 Sep 10:18
  run, 6 backup directories had accumulated (`_backups/phase1-091130`,
  `-091850`, `-092349`, `-094126`, `-100345`, `-101034`), each containing
  a same-named `test_money.py`/`test_canonicalise.py` with no valid
  Python package name (the directory names contain hyphens and dates),
  so pytest raised "import file mismatch" on 6 x 2 = 12 of them.
  **`money.py` and `canonicalise.py` were never actually broken** —
  re-running pytest scoped to `tests/` only reproduces the real result:
  30 passed, 0 failed, exactly the known-good baseline. Confirmed by
  reinstalling this exact `fiscal_core` package in a clean venv and
  running `pytest -q` before and after the fix below.
- **Fix, delivered as `Deliver-Phase1-MoneyCanonicalisation-V3.ps1`**:
  1. `pyproject.toml` now carries `[tool.pytest.ini_options]` with
     `testpaths = ["tests"]` and `norecursedirs` covering `_backups`,
     `_logs`, `.pytest_cache`, `venv`, `*.egg-info` — this alone is
     sufficient (verified: plain `pytest -q` now gives 30 passed with no
     CLI flags needed).
  2. `Invoke-PhaseGate` now also passes `--ignore=_backups --ignore=_logs
     --ignore=.pytest_cache --ignore=venv` explicitly on every gate call
     (phase4-fiscal, phase1-engine, phase2-backend alike) as a second
     layer, since phase1-engine's own `pyproject.toml` was not touched
     this session and may have the same latent issue from its own
     delivery history.
  3. `Invoke-PhaseGate` now always writes the **full** pytest stdout+stderr
     to `_logs/<phase>-pytest-<timestamp>.log`, not just a parsed summary
     line — the previous script threw away the actual traceback on
     failure, which is why the 26 Sep log only said "12 errors" with no
     detail to diagnose from.
  4. Backup retention: the script now prunes `_backups/phase1-*` down to
     the 2 most recent before writing new files, so this can't silently
     re-accumulate and re-break collection again.
  5. Fixed a second, independent real bug: `Ensure-PhaseVenv`'s blanket
     `pip install -e "$PhaseDir"` assumed every phase is an installable
     package with a `pyproject.toml`/`setup.py`. `phase2-backend` (FastAPI)
     has neither — hence the `[3/3]` gate's hard crash ("does not appear
     to be a Python project"), unrelated to the pytest-collection issue
     above. Fixed: install mode now falls back to
     `pip install -r requirements.txt` when no `pyproject.toml`/`setup.py`
     is present, or installs nothing (with a warning) if neither exists.
  6. Added `phase4-fiscal/.gitignore` covering `_backups/`, `_logs/`,
     `.pytest_cache/`, `venv/`, `__pycache__/`, `*.egg-info/` so none of
     this scratch state gets committed or confuses a future audit again.
- **Net effect for Kudakwashe**: nothing was wrong with the fiscal core
  code itself, and phase1-engine/phase2-backend were never actually
  modified by any phase4 session — Rule Zero held. The gate was failing
  on its own bookkeeping, not on QPD. `canonicalise.py` is still PARTIAL
  exactly as before (tax-line sort/fields only; full receipt and
  fiscal-day signing strings still raise `NotImplementedError`, still
  blocked on the same open item below) — this session did not touch that
  logic.


## 2026-09-25 (session 2) — Phase 1 (money & canonicalisation core), partial

- **`money.py` — COMPLETE.** Decimal-only monetary arithmetic (ROUND_HALF_UP
  throughout, float rejected outright). All money/percent/quantity rounding
  rules and the tax-amount/sales-amount-with-tax formulas (RCPT026/RCPT027)
  are traceable directly to spec Section 4.7 text fetched and read in full
  this session — not paraphrased from memory or a third party. Test vector
  `calc_tax_amount(["28.75"], "15", tax_inclusive=True) == Decimal("3.75")`
  reproduces the spec's own Section 4.9.1 worked file example exactly.
  30/30 tests pass, verified in a fresh venv with an editable install
  (`pip install -e ".[dev]"`) — not just "ran once in a scratch folder."

- **`canonicalise.py` — PARTIAL, and deliberately so.** ZIMRA's own Section 13
  ("Signatures generation and verification rules") — the exact byte sequence
  a device must sign — was NOT retrievable this session:
    - The direct ZIMRA PDF fetch (`zimra.co.zw/downloads`) truncates at
      Section 10.4 every time, confirmed reproducible across two separate
      fetch attempts with different token limits. This looks like a limit
      in the fetch/extraction pipeline on a 77-page PDF, not something a
      different query will fix.
    - Kudakwashe's own copy of the full spec PDF was uploaded in an
      **earlier, different session** (referenced as "(uploaded document)"
      in `Twelve-C-Virtual-Fiscalisation-Plan.md`'s sources list) and is
      not attached to this conversation.
  - What WAS found: a pull request against an open-source ZIMRA FDMS SDK
    (`github.com/munashe-chivandire/zimra-fdms`, PR #3,
    "fix: include taxCode in receipt signing string (RCPT020)") that
    quotes spec Section 13.2.1 directly — *"FDMS API spec v7.2 section
    13.2.1 defines the receipt tax signing string as: taxCode ||
    taxPercent || taxAmount || salesAmountWithTax"* — as justification for
    a fix that was live-tested against ZIMRA's test environment (device
    38561). This is primary-adjacent, not primary, but strong enough to
    implement the **field order and sort order** (by taxID, then taxCode
    alphabetically) of the tax-line signing segment with real confidence.
  - What was NOT implemented, on purpose: the exact numeric string
    formatting within that tax-line segment (decimal places, zero-padding,
    separators), the full receipt-level canonical string, and the
    fiscal-day-close canonical string. `build_tax_line_signing_segment()`,
    `build_receipt_signing_string()`, and `build_fiscal_day_signing_string()`
    all raise `NotImplementedError` with an explanation rather than
    guessing — a wrong signing algorithm is a compliance incident per
    `security.md`, not a bug to patch later. Tests confirm these raise
    (`TestUnverifiedFunctionsFailLoudly`), so a future session can't
    silently ship a guessed implementation without also replacing those
    tests with real spec-verified vectors.
  - One README-only (NOT spec-quoted) hypothesis was found for the full
    receipt-level string shape — `deviceID + receiptType + currency +
    receiptGlobalNo + receiptDate + total + tax-segments +
    previousReceiptHash` — but is explicitly flagged in the module
    docstring as unverified and must not be trusted as-is.

- **ACTION NEEDED from Kudakwashe before Section 13 work can complete:**
  upload the ZIMRA Fiscal Device Gateway API Specification v7.2 PDF (or at
  minimum pages covering Sections 11–13: QR code rules, CSR/certificate
  examples, and signature generation/verification rules) to a future
  session. Until then, Phase 2 (device identity & certificates, which
  depends on Section 12) and the rest of Phase 1's canonicalisation work
  are both blocked.

- Package structured as `phase4-fiscal/src/fiscal_core/` (installable via
  `pip install -e ".[dev]"`), matching the blueprint's own layout.
  `pyproject.toml` added with `pytest` as the only dependency for now —
  `cryptography` and an HTTP/mTLS library get added when Phase 2 starts.

## 2026-09-25 (session 1) — Phase 0 spec/notice check complete

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

## Open items carried forward

- **Blocking Phase 1 completion + all of Phase 2**: ZIMRA spec PDF Sections
  11–13 not available in-session. See 2026-09-25 (session 2) entry above.
- ZIMRA test-environment (Swagger) access + a taxpayer TIN/VAT number to test
  against — flagged in the plan as the actual bottleneck ("applications stall
  on paperwork, not code"). **Blocks Phase 2 (device identity/certs) and
  everything after it.** Kudakwashe to pursue.
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

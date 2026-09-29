# Twelve C — Phase 4 (Fiscalisation) Blueprint & Cross-Session Instructions
For Kudakwashe to hand to any future Claude session (or another AI) picking up this work.
Companion to `Twelve-C-Virtual-Fiscalisation-Plan.md` (the detailed phase-by-phase build plan) — that document is the *what*; this one is the *rules of engagement* so no session breaks what already works.

---

## Rule zero, non-negotiable: QPD must never be touched

Twelve C's QPD system (`phase1-engine`, `phase2-backend`, `phase3-frontend`) is **live and working**. Fiscalisation is a new, separate ZIMRA system (FDMS/TARMS, VAT-driven, per-transaction) from QPD (income tax, quarterly). It gets its own phase folder and its own everything:

```
twelve-c/
  phase1-engine/        # QPD engine — DO NOT MODIFY for fiscalisation work
  phase2-backend/        # QPD backend — DO NOT MODIFY for fiscalisation work
  phase3-frontend/       # QPD frontend — DO NOT MODIFY for fiscalisation work
  phase4-fiscal/          # NEW — everything fiscalisation-related lives here
    src/fiscal_core/
      money.py
      canonicalise.py
      crypto.py
      counters.py
      state.py
      fdms_client.py
      preflight.py
    tests/
```

**Any session working on fiscalisation may only create or edit files under `phase4-fiscal/`.** If a future session believes it needs to touch anything in `phase1-engine`, `phase2-backend`, or `phase3-frontend` (e.g. to add a fiscalisation tab to the existing dashboard, or share a `money.py` helper), that is a deliberate, explicit decision to flag to Kudakwashe first — never a default. Until he says otherwise, duplicate a small helper into `phase4-fiscal` rather than importing from `zimra_qpd` or editing a QPD file, even if that means a few lines of harmless duplication. Coupling the two systems is the actual risk, not the duplication.

## Every delivery script proves QPD is untouched

Every `phase4-fiscal` delivery script must, as part of its verification gate, also run the **existing** QPD test suites (`phase1-engine` and `phase2-backend` pytest) and confirm the pass/fail counts are unchanged from before the delivery — not just that phase4's own new tests pass. If QPD's pass count drops even by one test, treat that as a hard stop exactly like any other gate failure: auto-restore backups, do not commit, do not push.

## Delivery format stays exactly as established

Nothing changes about *how* code gets delivered — same PowerShell convention as the QPD work:

1. Auto-locate the repo (scan for the `zimra-qpd-web` `package.json`, same as always).
2. Back up every touched file with a timestamp before writing.
3. Write full file content via single-quoted PowerShell here-strings (`@'...'@`), never double-quoted — the code will contain `$` and backticks that must not be interpreted.
4. Write files with `[System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))` — never `Set-Content -Encoding utf8NoBOM` (breaks on Windows PowerShell 5.1) and never `Split-Path -LiteralPath ... -Parent` (throws a parameter-set error on this machine — use `[System.IO.Path]::GetDirectoryName()` instead).
5. Verification gate: `phase4-fiscal` pytest **plus** the existing `phase1-engine` and `phase2-backend` pytest (the QPD-untouched proof above) plus `phase3-frontend` `tsc --noEmit` if any frontend file changed.
6. Auto-restore all backups on any gate failure — nothing commits.
7. `git add -f` (explicit paths — this repo's `.gitignore` allow-list silently drops new files) → `git commit` → `git push`, all inside the script, never as manual follow-up steps.
8. If `phase4-fiscal`'s own venv doesn't exist yet, the first delivery script must create it and `pip install` its dependencies (`cryptography`, `httpx` or `requests` with mTLS support, `pytest`) before running the gate.

A skeleton for the first `phase4-fiscal` delivery script (fill in `$Files` and the phase-specific gate):

```powershell
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# --- repo locate (same Find-RepoRoot pattern as the QPD scripts) ---
# --- $Phase4 = Join-Path $RepoRoot "phase4-fiscal" ---

# --- write files under $Phase4 only — never $Phase1/$Phase2/$Phase3 ---

# --- verification gate ---
# 1. phase4-fiscal pytest (new)
# 2. phase1-engine pytest  <-- QPD-untouched proof, must match prior pass count
# 3. phase2-backend pytest <-- QPD-untouched proof, must match prior pass count
# 4. phase3-frontend tsc --noEmit, only if a frontend file was touched

# --- on any failure: Restore-Backups; throw; nothing commits ---

# --- git add -f (phase4-fiscal paths only, plus anything explicitly
#     approved outside it) -> commit -> push ---
```

## Build order (from the detailed plan — repeat this to any new session)

0. Spec lock-in — re-confirm current ZIMRA spec version + TARMS status before coding.
1. Money & canonicalisation core — no network calls, test-vector-driven.
2. Device identity & certificates — CSR, mTLS, against ZIMRA's **test** environment only.
3. Fiscal-day state machine — `Closed → Opened → Close Initiated → {Closed | Close Failed}`.
4. Receipt engine — `submitReceipt`, credit/debit note linkage, counters.
5. Offline durability & reconciliation.
6. Preflight/diagnostics engine (reuses the spec's own `DEV0x`/`RCPTxxx` codes).
7. TARMS integration (re-check current requirement first — this shifts).
8. Testing discipline, ongoing.
9. Security hardening — certs as security principals, encrypted storage, audit trail, in parallel throughout.
10. Sample documents & ZIMRA approval.
11. Pilot with one real business before anything is called a "launch."

**One phase per session is the target**, given the 5-sessions/day budget — name the phase at the start of the session rather than "continue where we left off."

## What a new session should do first

1. Read this file and `Twelve-C-Virtual-Fiscalisation-Plan.md`.
2. State which numbered phase (0–11 above) it's starting.
3. Confirm the current state of `phase4-fiscal/` (what already exists) before writing anything — don't assume phase N-1 is finished correctly; verify.
4. Never modify anything outside `phase4-fiscal/` without it being the explicit, stated goal of that session.
5. Every delivery script includes the QPD-regression gate described above, unconditionally.

---

*Companion document: `Twelve-C-Virtual-Fiscalisation-Plan.md` (25 Sep 2026) — detailed phase-by-phase to-do list, viability/money/recognition assessment, and spec summary.*

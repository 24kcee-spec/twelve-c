# HANDOVER - Twelve C Phase 4 after P5 (1 Oct 2026)

Paste at the start of the next session. Scope rule unchanged: only `phase4-fiscal/**` is touched; QPD folders are gated before/after.

## State
- Done: P0, P1, P2 (crypto+QR), P3 (key custody), P4 (FDMS client + simulator), **P5 (ledger + day state machine + audit)** once `Deliver-P5-Ledger-TWELVE-C.ps1` has run green and pushed.
- Tests: 453 in phase4-fiscal. On Windows one POSIX-only test skips: expect `passed=452; skipped=1`.
- P1-X: ZIMRA test-access email SENT, no reply recorded yet. Never commit deviceID / activation key / serial.

## First things to do next session
1. `git log -1` shows the P5 commit on origin/main; `git show --stat HEAD` lists only phase4-fiscal paths.
2. Next: **P6** `counters.py` (spec section 6; USD and ZiG never netted; rebuild-from-receipts reconciliation reading `FiscalStore.list_receipts`). Then P7 preflight, P8 receipt engine.

## Read before P8
`docs/P5-ledger-notes.md` section "Pattern P8/P9 MUST follow" (intent -> send -> record; the exact exception-to-state mapping).

## Open / unverified
- `fdms_client.ENDPOINTS` paths/verbs unverified until ZIMRA Swagger access (flag `ENDPOINTS_VERIFIED=False`).
- S7 (resubmit after reject), S8 (lastFiscalDayNo meaning), S9 (status timing after lost closeDay), plus F4/F8/S2/S4 - all settle in P13.
- F1: `tax_rules.py` untracked, phase1 baseline degraded - needs a separate approved QPD-hygiene session.
- Audit chain needs external anchoring (P17); ledger payloads hold buyer PII (encrypt at rest).

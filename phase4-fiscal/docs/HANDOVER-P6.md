# HANDOVER - Twelve C Phase 4 after P6 (2 Oct 2026)

Paste at the start of the next session. Scope rule unchanged: only `phase4-fiscal/**` is touched; QPD folders are gated before/after.

## State
- Done: P0, P1, P2, P3, P4 (client+simulator), P5 (ledger+state machine+audit), **P6 (counters)** once `Deliver-P6-Counters-TWELVE-C.ps1` has run green and pushed.
- Tests: 521 in phase4-fiscal. Windows: expect `passed=520; skipped=1` (one POSIX-only test).
- P1-X: ZIMRA test-access email SENT; no reply recorded. Never commit deviceID / activation key / serial.

## First things to do next session
1. `git log -1` shows the P6 commit on origin/main; `git show --stat HEAD` lists only phase4-fiscal paths.
2. Next: **P7** `preflight.py` - every RCPT010..RCPT048 rule with Grey/Yellow/Red colours (spec section 8 + 4.7), reusing `counters` sign/total checks. Then P8 receipt engine.

## Read before P8/P9
- `docs/P5-ledger-notes.md`: exception-to-state mapping (intent -> send -> record).
- `docs/P6-counters-notes.md`: only ACCEPTED receipts count; `counters_for_day` -> `to_canonical` -> signing string -> `close_day`.

## Open / unverified
- `fdms_client.ENDPOINTS` paths/verbs (ENDPOINTS_VERIFIED=False) until Swagger access.
- S2 (credit/debit counter order in signing string), S7, S8, S9, S10, F4, F8, S4 - all settle in P13.
- Simulator does not compute counters, so CountersMismatch is only a switch (improve before P9/P13).
- F1: `tax_rules.py` untracked, phase1 baseline degraded - needs a separate approved QPD-hygiene session.

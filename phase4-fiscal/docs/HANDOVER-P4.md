# HANDOVER - Twelve C Phase 4 after P4 (30 Sep 2026)

Paste at the start of the next session. Scope rule unchanged: only `phase4-fiscal/**` is touched; QPD folders are gated before/after.

## State
- Done: P0, P1 (spec lock-in), P2 (crypto+QR), P3 (key custody), **P4 (FDMS client + simulator)** once `Deliver-P4-FdmsClient-TWELVE-C.ps1` has run green and pushed.
- Tests: 267 total in phase4-fiscal (166 before P4 + 101). On Windows one POSIX-only file-mode test skips, so expect `passed=266; skipped=1`.
- P1-X: email requesting ZIMRA test-environment access SENT; awaiting reply. Do not put deviceID / activation key / serial in git.

## First things to do next session
1. Confirm `git log -1` shows the P4 commit on origin/main and `git show --stat HEAD` lists only phase4-fiscal paths.
2. Next phase: **P5** (persistence + audit + fiscal-day state machine; unique constraints on receipt numbers; hash-chained audit log). It uses `FdmsClient.get_status()` for reconciliation and `FdmsUnknownOutcomeError` handling.

## Known unverified items (do not forget)
- `fdms_client.ENDPOINTS` paths/verbs (flag `ENDPOINTS_VERIFIED=False`) - fix when Swagger access arrives.
- F4 ECDSA DER vs raw, F8 QR MD5 input, S2 counter order in signing string, S4 verification URL - all settle in P13.
- F1 (`tax_rules.py` untracked, phase1 baseline degraded) still needs a separate approved QPD-hygiene session.
- Chain trust is "consistent chain" only until a ZIMRA root is pinned.

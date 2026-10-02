# P5 notes - fiscal ledger, day state machine, audit log (1 Oct 2026)

Modules (`phase4-fiscal/src/fiscal_core/`): `state.py` (pure state machines + reconcile rules), `store.py` (SQLite ledger), `audit.py` (hash-chained log).
Tests: `test_state.py`, `test_audit.py`, `test_store.py`, `test_store_fdms_integration.py` (186 new). No new dependency (stdlib sqlite3).

## What P5 guarantees
- **Receipt numbers**: gap-free per device, unique, allocated under `BEGIN IMMEDIATE` (cross-process safe) AND backed by UNIQUE constraints. `receiptGlobalNo` continues across days; `receiptCounter` restarts each day. Verified with 6 competing connections x 10 reservations = exactly 1..60.
- **Crash safety**: `reserve_receipt` persists the unsigned `intent`; a receipt reserved but never signed/sent is recovered with the SAME numbers (a number is never given back). Intent is written BEFORE any network call (`begin_open_day`, `day_event(CLOSE_SENT)`, `begin_submit`).
- **Immutability**: signed payload + hash, identity columns and terminal states (ACCEPTED/REJECTED) are enforced by DB triggers, even against raw SQL. Receipts and days are never deleted.
- **Strict submission order** (spec section 9 item 13): `begin_submit` refuses while any lower number is unresolved (RESERVED/SIGNED/SUBMITTING/UNKNOWN).
- **Close gate**: a day cannot start closing while any of its receipts is unresolved (would be MissingReceipts).
- **No issuing** while the day is not OPENED/CLOSE_FAILED, after `taxPayerDayMaxHrs`, or while the device has an unresolved CONFLICT.
- **Atomicity**: every change and its audit row commit or roll back together (tested: an audit failure burns no receipt number).
- **Audit**: SHA-256 hash chain, contiguous seq, append-only triggers, secret-looking keys and PEM private-key text refused. No receipt bodies / buyer data in the audit rows.

## Pattern P8/P9 MUST follow (learned in the integration tests)
1. Persist intent -> 2. send -> 3. record outcome.
2. Map errors like this, for ANY endpoint whose request may have been processed:
   - `FdmsRejectedError` (422)            -> `mark_rejected` (definitive; number stays consumed)
   - `FdmsUnknownOutcomeError`, `FdmsTransportError`, `FdmsServerError` -> `mark_unknown` / leave the day PENDING
   An idempotent call whose retries run out raises Transport/Server errors, NOT UnknownOutcome; they still mean "FDMS may have processed it".
3. A day left in OPEN_PENDING / CLOSE_PENDING is resolved only by `get_status()` + `store.apply_reconciliation(...)`. If the evidence is not conclusive the device is flagged CONFLICT and a human calls `resolve_conflict(note=...)`.
4. A rejected `openDay` leaves a day with no `closed_utc`; the next `begin_open_day` re-uses the same day number (FDMS still expects it).

## HONEST LIMITS
1. **SQLite is single-host.** Multi-tenant / HA needs PostgreSQL (P15/P17). The method surface is what a Postgres store would implement.
2. **Audit chain is tamper-EVIDENT, not tamper-PROOF.** Someone with write access to the file can recompute every hash. Export `audit_head()` to a place the DB host cannot write and pass it to `audit_verify(anchor=...)`. Automated external anchoring is P17. Tail truncation is only detectable with an anchor (tested).
3. `ts_utc` is the local clock, not a trusted timestamp.
4. **Receipt payloads contain buyer personal data** and are stored in plain SQLite. Use full-disk encryption now; SQLCipher or an encrypted Postgres later (P17/P18). The store holds no keys/certs/activation keys (tested: no secret-named columns).
5. Ledger files must never be committed: `.gitignore` now also blocks `*.sqlite-wal`, `*.sqlite-shm`, `*.db-wal`, `*.db-shm`.
6. `reserve_receipt` checks `taxPayerDayMaxHrs` against the local clock; `now_local` is injectable for tests.

## NEW OPEN QUESTIONS (settle in P13)
- **S7**: spec section 9 item 13 says "on failure, fix and resubmit"; the vFiscal guide says a rejected receipt's number is consumed. P5 treats REJECTED as terminal (conservative). If FDMS allows re-sending the same `receiptGlobalNo` corrected, REJECTED needs an exit to SIGNED and the "payload immutable" trigger needs an attempts table.
- **S8**: `getStatus.lastFiscalDayNo` is assumed to be the most recent day (open or closed). Reconciliation depends on it.
- **S9**: which `getStatus` values FDMS reports right after a lost `closeDay` (CloseInitiated vs Closed timing) - reconcile handles both but real behaviour is unseen.

## Not done here
Counters P6 (rebuild-from-receipts reconciliation will read `list_receipts`); preflight P7; receipt builder/signing orchestration P8; day auto-close + polling P9; offline queue/`submitFile` P10.

# Security — Phase 4 Fiscalisation

Living reference. This is regulated, security-sensitive infrastructure — a
signature bug or a skipped receipt number is a compliance incident, not a bug
ticket. Every item below is a hard requirement, not a nice-to-have.

## Non-negotiables (launch-blockers if violated)

- [ ] **No `float` anywhere in the fiscal path.** `Decimal`/integer minor-units
      only, `ROUND_HALF_UP`, matching the rounding discipline already
      established in `phase1-engine`'s QPD `money.py`.
- [ ] **mTLS on every authenticated endpoint** — no code path that calls a
      non-public FDMS endpoint without presenting the device certificate.
- [ ] **Deterministic signing, verified against the spec's own test vectors**
      (Section 12/13 worked examples) before any live-network code is written.
      "It didn't error" is not verification.
- [ ] **Certificates and private keys never committed to git.** This repo
      already has a documented `.gitignore` allow-list gotcha (new files get
      silently dropped unless `git add -f`'d) — the inverse risk here is a
      secret getting added by accident. Explicit `.gitignore` entries for any
      cert/key paths under `phase4-fiscal/`, checked before every commit.
- [ ] **No silently skipped or reordered receipt numbers**, online or offline.
      Strict ascending `receiptGlobalNo`, one at a time.

## Certificate lifecycle

- Encrypted at rest — local dev may use an encrypted local store; production
  needs a real secrets manager (not decided yet — flag when Phase 9 starts).
- Rotation plan: renew ~1 month before `certificateValidTill` (from
  `getConfig`).
- Expiry monitoring/alerting — device must not silently go dark because a
  cert lapsed.
- Revocation handling — a 401 caused by revocation must surface clearly, not
  get swallowed as a generic network error.

## Audit trail

- Every fiscal-sensitive operation logged, append-only: day open, day close
  (attempt and outcome), receipt submit (attempt and outcome), certificate
  issue/renewal.
- Audit log itself must not be the thing that silently fails — treat logging
  failures as loud, not swallowed.

## Offline durability

- Durable local queue (real persistence — SQLite/file-backed, not in-memory)
  for receipts created while offline.
- Reconciliation job for "unknown outcome" submissions: explicit status check,
  never blind retry (see `fiscal-rules.md` §8).

## Least privilege & backups

- Service accounts/credentials scoped to only what `phase4-fiscal` needs —
  never reuse QPD's backend credentials or DB user for fiscal tables.
- Backups of fiscal state (fiscal day status, receipt queue, counters) tested,
  not just configured.

## Incident response

- [ ] Written incident-response plan exists **before** any real taxpayer goes
      live (Phase 11 gate, not before).

## Explicitly not yet sourced — do not guess

- Current ZIMRA statutory late-payment interest rate — needed for Step 6 of
  the compliance-layer work but **not yet verified**. Do not fabricate or
  estimate a figure; source it from ZIMRA's site the same way the 25.75% QPD
  rate was confirmed, when that work is picked up.

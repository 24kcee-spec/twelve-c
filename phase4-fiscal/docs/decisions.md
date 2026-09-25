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

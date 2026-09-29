# Twelve C — Virtual Fiscalisation Module
**Build plan, honest viability check, and detailed to-do list**
Prepared 25 September 2026, from the ZIMRA Fiscal Device Gateway API Spec v7.2, the "Zimbabwe Fiscal Compliance OS" blueprint, current ZIMRA public notices, and one live competitor's own pricing page.

---

## 0. The honest version, up front

**Is this worth building?** As a learning project and portfolio piece — yes, clearly. As "enterprise-grade, good enough for Delta and Econet" in the near term — no, not realistically, and you should go in knowing why:

- **A live competitor already exists, in Bulawayo, undercutting hard.** LineIT's *vFiscal ERP* sells full ZIMRA fiscalisation (registration + device + certificate) bundled with a complete ERP (invoicing, accounting, inventory, POS, CRM, unlimited users/branches) for **$115.50/year all-in**. That is the price you would be competing against on day one. Fiscalisation-only, unbundled, is not an obviously winnable price fight for a solo builder.
- **ZIMRA's own free portal already solves the compliance requirement.** ZIMRA gives every taxpayer a free virtual-fiscalisation facility (manual entry). What a paid product sells is *interfacing* — automating that entry — which is real value, but it's a narrower, harder-to-communicate pitch than "get fiscalised."
- **Enterprise clients like Delta/Econet are not a realistic near-term target.** They will ask about SOC2/ISO27001-style controls, HSM/KMS key custody, uptime SLAs, incident response, penetration test reports, and a support org behind the software — not just "the API works." The blueprint's own estimate is **8–14 months for a solo, pilot-ready system** and **12–24+ months for a production-grade multi-tenant platform**. Treat "Delta and Econet" as the multi-year aspirational ceiling, not the v1 target.
- **This is regulated, security-sensitive infrastructure, not a CRUD app.** Certificates are security principals; a signature bug or a skipped receipt number is a compliance incident, not a bug ticket. Section 5 of the blueprint (deterministic crypto, receipt sequencing, offline durability, unknown-outcome handling) is the real work, and it doesn't compress well under time pressure — get it wrong and the product is worse than useless, it's a liability.
- **Money:** realistic in order of likelihood — (1) a portfolio/CV asset that helps with ICAZ/TIPP interviews and freelance dev work, (2) a paid interfacing tool for a handful of small Bulawayo businesses at a modest annual fee, (3) a genuine SaaS business, only if (1) and (2) validate real demand and you either bring in a co-founder for the security/ops side or invest the 12+ months yourself. Don't plan the smaller wins around the biggest one happening.
- **Recognition:** genuinely yes, and this is the strongest part of the case. A working, tested virtual fiscal device — actually opening a fiscal day, submitting a signed receipt, and closing the day against ZIMRA's test environment — is a rare, credible achievement for a third-year BCom student. That's a real story for ICAZ interviews, a CV line, and a demo you can actually show someone, regardless of whether it ever becomes a company.

**Recommendation:** build this as **Phase 4 of Twelve C, scoped down hard for v1** — a single-tenant proof of concept that fiscalises your own (or one pilot business's) invoices correctly and passes ZIMRA's test environment — before writing one line of multi-tenant SaaS code. Prove the fiscal core is correct first; the dashboard, billing, and "many customers" layer only matters if the core is solid and someone actually wants to pay for it.

---

## 1. What the spec actually requires (from the real v7.2 document, not the blueprint's paraphrase)

- **Access:** HTTPS + mutual TLS. Only `registerDevice`, `verifyTaxpayerInformation`, and `getServerCertificate` are public/unauthenticated; every other endpoint requires your device's client certificate.
- **Environments:** `https://fdmsapitest.zimra.co.zw` (test, Swagger UI available) and `https://fdmsapi.zimra.co.zw` (production).
- **Core endpoints (Section 4):** `verifyTaxpayerInformation`, `registerDevice`, `issueCertificate`, `getConfig`, `getStatus`, `openDay`, `submitReceipt`, `submitFile`, `getFileStatus`, `closeDay`, `getServerCertificate`, `ping`, a full user-management block (`login`, `createUserBegin/Confirm`, password reset, security codes), `getStockList`.
- **Certificates:** both ECC (secp256r1) and RSA-2048 CSR/certificate flows are documented with worked examples (Section 12).
- **Signatures:** device signs receipts and fiscal-day closes before submission; FDMS counter-signs on acceptance (Section 13). This is what the QR code actually verifies.
- **Counters:** per-tax, per-currency, lifetime and per-day (Section 6) — USD and ZiG **never netted**, matching Twelve C's own Section 37AA rule for QPD.
- **Errors:** RFC 7807 problem-details JSON, structured error codes (`DEV01`…, `RCPTxxx` validation codes) — this is a gift for building the "Preflight Engine" the blueprint recommends, since the exact validation rules are already enumerated in the spec.
- **Regulatory context (current, not in either document):** TARMS–FDMS integration became **mandatory on 31 December 2025** under Public Notice 63 of 2025 — by the time you build this, it isn't optional, it's already in force. Standard VAT rate referenced in current guides is **15.5%**, separate from Twelve C's own 25.75% QPD rate (different tax, don't conflate them).

---

## 2. Scope decision for Twelve C

Twelve C is a provisional-tax (QPD) calculator. Fiscalisation is a *different* ZIMRA system (FDMS/TARMS, VAT-driven, per-transaction) from QPD (income-tax, quarterly). Recommend treating it as a genuinely separate phase, not bolted onto the existing engine:

```
twelve-c/
  phase1-engine/        # existing QPD engine (zimra_qpd)
  phase2-backend/        # existing FastAPI backend
  phase3-frontend/       # existing Next.js frontend
  phase4-fiscal/          # NEW — fiscal core, isolated
    src/fiscal_core/
      money.py            # Decimal minor-units arithmetic, never float
      canonicalise.py      # deterministic field ordering for signing
      crypto.py            # CSR, cert handling, ECDSA/RSA signing
      counters.py          # per-day / lifetime / per-tax counters
      state.py             # fiscal-day state machine
      fdms_client.py        # mTLS HTTP client, all 4.x endpoints
      preflight.py          # validation engine using spec's own RCPT/DEV codes
    tests/
```

Keeping it a sibling phase (not merged into `phase1-engine`) means a mistake in fiscal-day state handling can never accidentally touch the QPD engine that already works and is in production use.

---

## 3. Detailed to-do list, in build order

### Phase 0 — Specification lock-in (3–5 days)
- [ ] Re-download the current Fiscal Device Gateway API spec directly from ZIMRA (`zimra.co.zw/downloads`) and diff it against the v7.2 copy you have — confirm you're building against the version currently in force.
- [ ] Read current ZIMRA public notices on TARMS–FDMS integration (PN 63/2025 and any successor) — this is a hard requirement now, not future work.
- [ ] Write `fiscal-rules.md`, `fdms-contract.md`, `security.md`, `decisions.md` as living reference docs (per the blueprint's own AI-workflow advice) — feed only the relevant one into each future Claude session instead of re-uploading the whole spec every time.
- [ ] Get ZIMRA test-environment (Swagger) access and a taxpayer TIN/VAT number to test against — this is the actual bottleneck the pricing-guide document flags ("applications stall on paperwork, not code").

### Phase 1 — Money & canonicalisation core (1–2 weeks)
- [ ] `money.py`: integer minor-units or `Decimal` arithmetic only, `ROUND_HALF_UP` — reuse the exact rounding discipline already established in Twelve C's QPD engine.
- [ ] `canonicalise.py`: exact field-order/format transcription of Section 13's signing rules. Build a **test-vector suite** from the spec's own worked examples before writing any live-network code — this is the single highest-risk area (silent signature mismatches).
- [ ] Unit tests only at this stage — no network calls yet.

### Phase 2 — Device identity & certificates (1–2 weeks)
- [ ] CSR generation for both ECC (secp256r1) and RSA-2048, matching Section 12's examples exactly.
- [ ] `registerDevice` + `issueCertificate` flow against the **test** environment.
- [ ] Certificate storage: never in plain files in the repo — local dev can use an encrypted store; production needs a real secrets manager (see Phase 9).
- [ ] mTLS client setup (`fdms_client.py`) — confirm the client correctly presents its cert on every authenticated call and handles `401` per Section 7.3's four documented causes (not-issued-by-gateway, revoked, expired, wrong device).

### Phase 3 — Fiscal-day state machine (1–2 weeks)
- [ ] Implement the state machine literally: `Closed → Opened → Close Initiated → {Closed | Close Failed}` — make illegal transitions raise, don't just log.
- [ ] `openDay` / `getStatus` / `closeDay` against test environment.
- [ ] Persist fiscal-day state in your own DB, not just inferred from ZIMRA's last response — you need to know your own state even when the network is down.

### Phase 4 — Receipt engine (2–4 weeks, largest single phase)
- [ ] `submitReceipt` for `FiscalInvoice`, `CreditNote`, `DebitNote` — implement every `RCPTxxx` validation rule from Section 4.7 as a local preflight check *before* you burn a receipt number (the guide's own advice: a receipt number is consumed on submission whether accepted or rejected).
- [ ] Counter updates per Section 6's table (`SaleByTax`, `SaleTaxByTax`, `CreditNoteByTax`, etc.) — credit notes decrement, debit notes increment, currencies never mixed.
- [ ] Credit/debit note linkage rules (must reference an existing receipt, same currency, can't exceed original amount net of prior notes) — the guide specifically calls this out as "the part most implementations get wrong."
- [ ] `submitFile` / `getFileStatus` if you need bulk/offline batch submission.

### Phase 5 — Offline durability & reconciliation (2–3 weeks)
- [ ] Durable local queue (real persistence, not in-memory) for receipts created while offline.
- [ ] Strict in-order submission on reconnect — no reordering, no silently-dropped receipt numbers.
- [ ] A **reconciliation job**: for every receipt whose outcome is unknown after a network failure, explicitly check its status rather than blindly retrying (Section 5.7 of the blueprint — "unknown outcome" is a named failure mode for a reason).

### Phase 6 — Preflight / diagnostics engine (1–2 weeks)
- [ ] Map every `DEV0x` and `RCPTxxx` code from Section 8 into a plain-language explanation (the blueprint's "Fiscal Compliance Intelligence" idea) — this is genuinely differentiated, low-risk, and reuses work you've already done above.
- [ ] Distinguish **Accepted / Accepted-with-advisory / Rejected** explicitly in the UI — the guide is blunt that treating an advisory as an error is a real, common mistake that erodes user trust.

### Phase 7 — TARMS integration (timing depends on ZIMRA's current rollout — check first)
- [ ] Confirm current TARMS–FDMS integration requirements against the latest public notice before building — this changed at least twice in 2025 (PN 22/2025, PN 63/2025) and may change again.

### Phase 8 — Testing discipline (ongoing, not a phase you finish)
- [ ] Unit: money, canonicalisation, signatures, counters, state transitions.
- [ ] Contract: request/response schemas against the spec.
- [ ] Integration: full flow against ZIMRA's **test** environment.
- [ ] Chaos: kill the process mid-submission, drop the network, force a duplicate retry, expire a certificate — the blueprint's chaos-test list is a good starting checklist.
- [ ] Reuse Twelve C's existing gate discipline: this phase gets its own `pytest` suite, run in your delivery script exactly like `phase1-engine`/`phase2-backend` are now.

### Phase 9 — Security hardening (parallel, not an afterthought)
- [ ] Certificates and private keys: encrypted at rest, least-privilege access, rotation plan, expiry monitoring/alerting.
- [ ] Audit trail for every fiscal-sensitive operation (day open/close, receipt submit, cert issue).
- [ ] Secrets never in git — you already have a documented `.gitignore` gotcha on this repo; make sure it doesn't bite here too.

### Phase 10 — Sample documents & ZIMRA approval (timing: after Phase 4–6 are solid)
- [ ] Generate the exact `Receipt48`/`InvoiceA4` formats from Section 10, submit as the "sample documents" step the onboarding guide describes, get ZIMRA sign-off before going live with a real taxpayer.

### Phase 11 — Pilot, not launch
- [ ] One real business (ideally your own, or one you can watch closely), production credentials, real fiscal days, for a real filing period, before you show this to anyone as a product.

---

## 4. Enterprise-grade / security checklist (condensed)

- TLS/mTLS everywhere; no endpoint reachable without it.
- Decimal-only money math — a single `float` in the fiscal path is a launch-blocker.
- Deterministic signing verified against spec test vectors, not just "it didn't error."
- Certificates treated as security principals: encrypted storage, rotation, expiry alerts, revocation handling.
- Full audit log of fiscal operations, immutable/append-only.
- Durable offline queue with strict ordering — no silently skipped receipt numbers, ever.
- Explicit reconciliation for unknown-outcome submissions.
- Least-privilege service accounts; encrypted, tested backups.
- A written incident-response plan before any real taxpayer goes live on it.

---

## 5. Sources

- ZIMRA Fiscal Device Gateway API Specification v7.2 (uploaded document)
- "Zimbabwe Fiscal Compliance OS" blueprint (uploaded document, 21 Sep 2026)
- ZIMRA — *Compliance with the ZIMRA Fiscalisation Data Management System (FDMS)*, zimra.co.zw/news
- ZIMRA — *Fiscalisation Explained*, zimra.co.zw/domestic-taxes/corporate/fiscalisation-explained
- LineIT *vFiscal ERP* — "ZIMRA Fiscalisation in Zimbabwe: Complete 2026 Guide" (uploaded document) — pricing and onboarding-timeline figures
- e-invoice.app — Zimbabwe country page, TARMS–FDMS mandate timeline (Public Notices 40/2023, 92/2023, 22/2025, 63/2025)

This is a planning document, not legal/tax advice — re-verify ZIMRA's current requirements before writing production code, exactly as the blueprint itself says.

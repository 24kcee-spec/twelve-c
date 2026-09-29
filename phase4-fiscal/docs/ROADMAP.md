# Twelve C — Phase 4 (Fiscalisation): Status Audit + Remaining Work, in Order
Audit date: 29 Sep 2026. Basis: `github.com/24kcee-spec/twelve-c` (main, cloned and diffed), your `phase_4_fiscal_excluding_venv.zip`, `Deliver-Phase4-Fiscal-V2-TWELVE-C.ps1`, ZIMRA Fiscal Device Gateway API v7.2 (read directly, not from summaries).
Target: enterprise-grade (Delta / Econet class), solo, $0 budget, ~5 sessions/day.

---

## 1. Did the last push work? — YES

| Check | Result |
|---|---|
| Commits on `origin/main` | `2f9c53f` (28 Sep 15:06) money core + scaffold; `d6a1155` (28 Sep 15:08) canonical signing strings + counter ordering |
| Files in commits | Only `phase4-fiscal/**` (money.py, canonicalise.py, tests, pyproject, .gitignore, docs addenda) |
| Hash parity | All 6 code/config files in the remote commit and in your zip match the SHA-256 values hard-coded in the V2 script |
| Test suite | Re-run on your uploaded copy: **52 passed** (matches the 52 the script/decisions.md claim) |
| QPD untouched | `git diff 6cbdb1e..HEAD -- phase1-engine phase2-backend phase3-frontend` is **empty** |
| Docs | decisions.md / fiscal-rules.md on remote = local (differ only by CRLF/LF line endings) |

**What is done:** Phase 0 (reference docs), Phase 1 (money + canonicalisation string builders, tested against the spec's own worked examples).
**What that is, honestly:** roughly the first 5% of the build. Nothing has yet touched ZIMRA's test environment.

---

## 2. Findings that must be handled first

| # | Severity | Finding | Action |
|---|---|---|---|
| F1 | **High** (QPD-side, needs your explicit OK) | `phase1-engine/src/zimra_qpd/tax_rules.py` is **not tracked in git** (only the vendored copy in `phase2-backend/engine/` is). `calculator.py` imports it. A fresh clone cannot collect phase1 tests — this matches your 26 Sep log (`7 errors`, `No module named 'zimra_qpd.tax_rules'`). Likely the `.gitignore` allow-list gotcha. Caveat: I can see git and your zip, not your local phase1 folder — the file may exist locally but untracked. Also committed junk: `.bak` files and `__pycache__/*.pyc` in `phase2-backend/engine/zimra_qpd/`. | Separate QPD-hygiene session, only after you approve touching phase1/phase2. Not done inside Phase 4. |
| F2 | Medium | V2 delivery script replaced the blueprint's rule "run phase1 + phase2 pytest and compare pass counts" with a `git status` snapshot of the QPD folders. Weaker: proves no edits, not that QPD still passes. Caused by F1. | Restore the full QPD pytest gate after F1 is fixed (P0). |
| F3 | **High** (correctness) | Spec §13.3.1 worked example is internally inconsistent: it lists SaleByTax ZWL rows before USD, and its hash was computed over a string with a stray `L` (`USDLCASH`). `canonicalise.py` follows the *stated* rule (currency alphabetical). Unproven against ZIMRA. | Prove on ZIMRA test env (P13). A wrong order surfaces as `BadCertificateSignature` (§5.4.9), distinct from `CountersMismatch` — that is the diagnostic signal. |
| F4 | **High** (correctness) | §13.1 says only `ECC(Hash, CURVE, g, n)` / `RSA(...)`. I found **no statement of ECDSA signature encoding** (ASN.1 DER vs raw r‖s) or RSA padding. Guessing wrong = every receipt `RCPT020` (Red). | Settle in P2 against §12 sample keys/certs, then confirm on test env. |
| F5 | Medium | `phase4-fiscal/.gitignore` has no cert/key patterns (`*.pem *.key *.csr *.crt *.p12 secrets/`). security.md makes this a launch-blocker; P2 is about to generate keys. | Add in P0, before any crypto code exists. |
| F6 | Low | 52 tests are all pure string-builder tests. No network, persistence, or signing yet. | Expected at this stage; tracked by gates below. |

---

## 3. Reality check for the Delta / Econet target

Code correctness alone does not win these clients. Their procurement will require, in this order of importance:
1. **ZIMRA sign-off** (sample documents + successful test-env cycle) and being a credible, listed supplier.
2. **Integration into their ERP** (typically SAP / Oracle / Dynamics) — they will call *your* service; they will not adopt your UI.
3. **Independent security evidence**: third-party penetration test, key custody (HSM/KMS), audit trail, ISO 27001 / SOC 2-style controls, incident response.
4. **Operational proof**: uptime SLA, HA/DR, support hours, references from a live pilot.
5. **Throughput design**: spec §9 requires receipts submitted **strictly one-by-one in ascending `receiptGlobalNo` per device**. Each device is a serial lane; scale comes from many devices/tills/branches processed in parallel, never from parallelising one device. Confirm with ZIMRA how large taxpayers register devices.

Items 1, 3 (pen test), 4 (references) are **external dependencies** — code cannot substitute for them. They are placed on the critical path below.

---

## 4. PHASE BREAKDOWN

Duration unit = one focused Claude session (target: one phase-step per session). Estimates assume the 5-sessions/day budget and that you run each delivery script and report results.

| Phase | Task | Tool / File | Duration | Dependency | Risk / Fallback |
|---|---|---|---|---|---|
| **P0** | Hygiene: (a) resolve F1 with your approval, (b) add cert/key patterns to `.gitignore` (F5), (c) new delivery-script template restoring full QPD pytest gate (F2), (d) commit blueprint + plan `.md` files into `phase4-fiscal/docs/` | PowerShell V3 script | 1 | Your approval for F1 | If you defer F1: keep git-status gate, mark gate as *degraded* in every script output |
| **P1** | Spec lock-in remainder: web-check for a newer spec than v7.2 and latest TARMS–FDMS notice (PN 63/2025 successors); distil unread sections into docs — §4.8 file format (3 MB, header/content/footer), §4.13 users, §4.15 stock, §5 data types, §10 Receipt48/InvoiceA4/Z-X report layouts; write `fdms-contract.md` fixtures | Web search + spec PDF | 1–2 | — | If ZIMRA published a newer spec: diff and update canonicalise tests first |
| **P1-X** | **External, start now (long lead time):** obtain ZIMRA test-environment access, a test TIN/VAT, deviceID + activation key + serial + registered model name/version | ZIMRA / a real taxpayer | Days–weeks (calendar) | Paperwork | Single biggest schedule risk. Fallback: build a local FDMS simulator (P4) so P2–P10 are not blocked |
| **P2** | `crypto.py`: ECC secp256r1 + RSA-2048 keygen; CSR with exact CN `ZIMRA-<serial>-<10-digit deviceID>` and C/O/S rules; SHA-256; device signing; base64; settle F4 (signature encoding) using §12 sample keys and certs as test vectors; verify FDMS signatures (`getServerCertificate` chain); `qr.py` per §11 (MD5 → first 16 hex, ddMMyyyy, padding) | `cryptography` lib | 2 | P0 | If encoding ambiguous: implement both behind a flag, test-env decides |
| **P3** | Key custody: `KeyProvider` interface; dev provider = encrypted-at-rest keystore (AES-GCM, scrypt/Argon2 KDF, DPAPI where available); private key never leaves provider (sign-only API); prod providers stubbed for Azure Key Vault / AWS KMS / HSM (PKCS#11) | Python | 1–2 | P2 | Zero-budget fallback: encrypted file store + strict permissions; documented as *not enterprise-grade* until KMS/HSM provider is implemented |
| **P4** | `fdms_client.py`: httpx + mTLS; mandatory `DeviceModelName` / `DeviceModelVersionNo` headers; 30 s timeout; all endpoints (verifyTaxpayerInformation, registerDevice, issueCertificate, getConfig, getStatus, openDay, submitReceipt, submitFile, getFileStatus, closeDay, getServerCertificate, ping, getStockList; users block optional); RFC 7807 → typed exceptions; 401 classified into the 4 causes (§7.3); retry only on 500/502/timeout; never retry 4xx. **Plus a spec-faithful local FDMS simulator** for offline testing | httpx, pytest, FastAPI (sim) | 2–3 | P2 | Simulator is for logic tests only; never a substitute for P13 |
| **P5** | Persistence + audit + fiscal-day state machine (`state.py`): `Closed → Opened → CloseInitiated → {Closed \| CloseFailed}`; illegal transitions raise; DB schema (SQLite dev → PostgreSQL prod) with **unique constraints on (device, receiptGlobalNo) and (device, fiscalDay, receiptCounter)**; numbers allocated inside a DB transaction; append-only, hash-chained audit log; max-day-hours enforcement + end-of-day notification (§9 #4–5); VAT-number-appears-mid-day rule (§9 #9) | SQLAlchemy, Alembic | 2–3 | P4 | Get numbering wrong = compliance incident; property tests mandatory |
| **P6** | `counters.py` per §6: 7 counter types × tax × currency × money type; credit-note negatives; Discount lines; USD/ZWG never netted; rebuild-from-receipts reconciliation to prove counters == sum of stored receipts | Python + Hypothesis | 1 | P5 | Any drift → block close |
| **P7** | `preflight.py`: every local rule RCPT010–RCPT048 from §4.7/§8.2.1 (incl. tax-id/percent vs `getConfig.applicableTaxes`, HS-code rules 047/048, credit/debit linkage 015/029/032–036/042/043, buyer data, invoiceNo uniqueness, payments = total to the cent); classify Grey / Yellow / Red exactly as §8.2.1 | Python | 2 | P1, P6 | Run **before** a receipt number is consumed |
| **P8** | Receipt engine: build → preflight → allocate numbers → sign (canonicalise + crypto) → persist (outbox) → submit → store FDMS signature → counters → QR. Crash-safe (kill at any line and recover); relies on spec §4.7: identical resubmission returns the original `receiptID` (safe retry key = deviceID + receiptGlobalNo + hash) | Python | 2–3 | P3, P4, P5, P6, P7 | "Unknown outcome" handled by reconcile-by-resubmit, never blind renumber |
| **P9** | Day lifecycle: `openDay` (fiscalDayNo rules), `closeDay` async → poll `getStatus`; handle `FiscalDayCloseFailed` and the 4 `FiscalDayProcessingError` values; block close when Grey/Red exist; auto-close scheduler; manual-reconciliation mode; `ping` heartbeat at `reportingFrequency` | Python | 2 | P8 | Stuck day → operator runbook + ZIMRA manual close path (§2.3) |
| **P10** | Offline / batch: durable ordered queue with backoff (spec §9 #13–14); `submitFile` header/content/footer, single fiscal day per file, 3 MB splitting (footer never split), base64 JSON, `getFileStatus` incl. `WaitingForPreviousFile` | Python | 2 | P8, P9 | Ordering bugs are the #1 gap-risk; chaos tests in P13 |
| **P11** | Diagnostics: plain-language map for every `DEV*`, `RCPT*`, `FISC*`, `FILE*` code; Accepted / Accepted-with-advisory / Rejected surfaced distinctly (advisory ≠ error) | Python | 1 | P7 | — |
| **P12** | Documents: Receipt48 and InvoiceA4 views, X / Z reports (§10), QR rendering; must show every mandatory field | HTML→PDF / ESC-POS | 2 | P8, P9 | Needed verbatim for ZIMRA sample-document approval (P19) |
| **P13** | **ZIMRA test-environment campaign**: register device, cert issue, full open→receipts→close cycle; resolve F3 and F4 empirically; credit/debit notes; both currencies; offline file path; chaos suite (kill mid-submit, drop network, duplicate retry, expired/revoked cert, clock drift, out-of-order) | Real test env | 2–3 | P1-X, P2–P12 | If access still missing: P13 stays open; do not proceed to P19+ |
| **P14** | TARMS–FDMS integration per the notice found in P1 (mandatory since 31 Dec 2025 per plan; re-verify) | TBD | 1–2 | P1 | Scope unknown until P1 re-check |
| **P15** | **Enterprise service layer**: `fiscal-gateway` REST API (OpenAPI) — multi-tenant model (tenant → taxpayer → branch → device); OAuth2 client-credentials + optional mTLS for callers; API keys, scopes, rate limits; mandatory **idempotency keys**; webhooks for receipt/day events; **one serial worker lane per device** with fenced leases (prevents two instances issuing the same `receiptGlobalNo`) | FastAPI, PostgreSQL | 3–4 | P8–P10 | Split-brain on a device lane is a compliance incident → lease + fencing token required |
| **P16** | Integration kit: SDKs (Python, .NET, Java), SAP (OData/IDoc pattern) and Oracle reference adapters, Sage/CSV/SFTP batch adapter, Postman collection, sandbox tenant | Multiple | 3–4 | P15 | Ship generic API + SDK first; ERP adapters per prospect demand |
| **P17** | Operations: structured logs, metrics, tracing; alerts (cert expiry < 30 days, day open > max hrs, queue depth/age, Grey receipts, close-failed, ping missed); status page; HA (active-passive with lane leases), backups with **tested restores**, RPO/RTO targets, runbooks | OpenTelemetry, Prometheus/Grafana | 2–3 | P15 | Free tiers only until revenue |
| **P18** | Security assurance: STRIDE threat model, SBOM + dependency/secret scanning in CI, SAST, key-rotation drill, least-privilege service accounts (never reuse QPD DB user), data-retention policy, Cyber & Data Protection compliance review (verify current Zimbabwean statute with a lawyer), written incident-response plan, **independent penetration test** | GitHub Actions, external tester | 2–3 + external | P15–P17 | Pen test needs budget → the one place $0 breaks; seek a university/ICAZ-network sponsor or defer enterprise pitch |
| **P19** | ZIMRA approval: submit sample Receipt48/InvoiceA4 documents + evidence of successful test cycle; obtain sign-off | ZIMRA | External (weeks) | P12, P13 | Gate for any real taxpayer |
| **P20** | Pilot with one real, VAT-registered business on production credentials for a full filing period; daily reconciliation vs ZIMRA portal | Production | External (1–3 months) | P19, P18 | Do not call it a launch before this passes |
| **P21** | Enterprise readiness pack: security questionnaire answers, architecture & DR documents, SLA/ToS/DPA templates, pricing, support model, load-test report (many parallel device lanes), reference from P20 | Docs | 2–3 | P20 | Approach Delta/Econet **after** P20, not before |

Estimated internal effort: ~40–50 sessions (P0–P18). Calendar time is dominated by external items (P1-X, P19, P20, pen test).

---

## 5. CRITICAL PATH

`P0 → P1 → (P1-X in parallel, start immediately) → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → P12 → P13 → P19 → P20 → P21`
Parallel side-track (does not block P13): `P11`, `P14` (after P1), `P15–P18` (after P8–P10; must finish before P21).

---

## 6. SESSION BUDGET (replaces "AI quotas")

- Target: one phase-step per session; name the phase at the start (e.g. "Starting P2").
- Each session ends with one PowerShell delivery script + one gate result pasted back.
- Retry rule: a failed gate = fix in the *next* session's first step; never stack a new phase on a failing one.
- Long steps (P5, P8, P15, P16) are pre-split into sub-sessions: schema / logic / crash-tests.

---

## 7. QUALITY GATES (nothing proceeds without these)

| Gate | Condition |
|---|---|
| G0 (after P0) | Full phase1 + phase2 pytest counts recorded as baseline and enforced in every script |
| G1 (after P2) | Signature/QR code reproduces §11–§13 and §12 sample-key vectors; F4 resolved or flagged with both variants |
| G2 (after P4) | Every endpoint contract-tested against the simulator; 401 four-cause classification tested |
| G3 (after P8) | Kill-at-every-line crash test passes: no skipped, duplicated or reordered `receiptGlobalNo` |
| G4 (after P9–P10) | Full simulator cycle incl. offline queue and file mode; counters == sum of receipts |
| G5 (after P13) | Real test-env cycle: day opens, signed receipts accepted, day closes **without** `BadCertificateSignature` / `CountersMismatch`; F3 and F4 closed |
| G6 (before P20) | ZIMRA sign-off + pen-test findings (High/Critical) closed |
| G7 (before P21) | Pilot period reconciled to the cent against ZIMRA records |

Standing rules on every delivery: no `float` in the fiscal path, only `phase4-fiscal/**` touched, `git add -f` explicit paths, script backs up + auto-restores on failure, no secrets in git.

---

## 8. SCOPE CUT PROTOCOL (if behind schedule — cut in this order)

1. Defer: P16 ERP adapters beyond the generic API + one SDK.
2. Defer: X/Z report polish in P12 (keep mandatory receipt/invoice fields).
3. Defer: users-management endpoints (§4.13), `getStockList`.
4. Defer: multi-region HA (keep single-region + tested backups).
5. **Never cut:** P2 correctness, P5 numbering guarantees, P8 crash-safety, P13 test-env proof, P18 pen test, P19 ZIMRA approval, P20 pilot.

---

## 9. Open questions I will not guess (need ZIMRA / you)

- Current ZIMRA spec version and TARMS–FDMS requirements (P1).
- ECDSA signature encoding and RSA padding for §13 (F4).
- Cross-currency counter ordering inside one counter type (F3).
- How very large taxpayers are expected to register devices (per till, per branch, or per business) — determines P15 throughput design.
- Data-retention period and data-protection obligations for stored fiscal records (lawyer/ZIMRA).
- Whether you approve a separate QPD-hygiene session for F1.

---

*Next step when you say go:* **P0** (hygiene + restored QPD gate). If you would rather start with the code that unblocks everything else, **P2** (crypto + QR) is the highest-value engineering step, but P0 should come first so P2's keys can never be committed.

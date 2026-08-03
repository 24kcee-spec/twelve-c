# ZIMRA QPD Calculator — full-stack blueprint (v2)

Updated from the original web/desktop/Android plan to include a Python backend, accounts, security, and monetization, per the expanded scope. Phase 1 is complete as of this document — see section 3.

---

## 1. Architecture

One Python calculation engine sits behind an API. Every client — web, desktop, Android — talks to the same API instead of duplicating logic.

| Layer | Technology | Role |
|---|---|---|
| Calculation engine | Python (this is `zimra_qpd`, done — see Phase 1) | Pure functions: no I/O, no storage, fully unit-tested against the real workbook's numbers |
| Backend API | FastAPI + PostgreSQL | Wraps the engine, owns accounts, stores each business's quarterly data, issues the QPD schedule |
| Auth | JWT sessions, bcrypt/argon2 password hashing, optional TOTP MFA | Standard, well-audited patterns — no custom crypto |
| Web app | Next.js, calls the API | Primary interface |
| Desktop app | Tauri, wraps the web build | Windows / Mac / Linux installers |
| Android app | Capacitor, wraps the web build | Play Store distribution |
| Payments | Paynow (EcoCash / OneMoney / local cards) + Stripe (international cards) | Subscription billing — verify current Paynow integration details when this phase starts, gateway specifics change over time |

---

## 2. Security checklist

- Passwords hashed with bcrypt/argon2, never stored plain
- Optional MFA (TOTP) at signup
- All traffic over HTTPS; rate-limited auth endpoints to block brute-force
- Role-based access (owner vs staff/accountant seats, for later multi-user businesses)
- Full audit log — every login and every calculation timestamped, so a user can show exactly what they filed and when
- Data encrypted at rest in Postgres; backups encrypted separately
- Dependency scanning (`npm audit`, `pip-audit`) before every release
- Signed builds for desktop (Tauri) and Android (Play App Signing)
- No third-party analytics/trackers by default — this handles people's tax data

---

## 3. Phase 1 — Python calculation engine ✅ done

Delivered as `zimra-qpd`, a standalone, installable Python package.

**What it does**, ported line-by-line from the ITF12C 2025 sheet:
- Currency normalisation and USD/ZIG trade ratio
- Public Notice 71's 50/50 capping rule — correctly asymmetric: only caps when USD is the dominant trading currency, uses the real ratio uncapped when ZIG dominates
- Adjusted income and deductions, re-split by the payment ratio
- Taxable profit, tax payable, AIDS levy, total tax
- The Q1–Q4 QPD schedule (10% / 25% / 30% / 35%)

**Two bugs found in the original workbook, fixed here:**
1. The QPD schedule's column E referenced an empty cell (`E33`) and silently evaluated to zero every time.
2. The "QPD Payments Made" tracking section referenced blank cells and never actually computed anything — `apply_payments()` is a working replacement.

**Verified correct:** 13 unit tests check the engine's output against the exact figures your own workbook produces (USD 12,000 sales example: taxable profit USD 50 / ZIG 1,340, total tax USD 12.875 / ZIG 345.05, Q1 instalment USD 1.29 / ZIG 34.51). All 13 pass.

**Current rate confirmed:** corporate tax 25% + 3% AIDS levy on the tax payable = 25.75% effective, matching your workbook and confirmed against current external sources (not the 24.72% figure floating around some tax-guide sites, which is stale). Both rates are parameters on `QpdInput`, not hardcoded — a future budget change is a config value, not a code change.

Package delivered separately in this conversation — install with `pip install -e .`, run `python demo.py` for a worked example, `python -m pytest tests/ -v` to re-run the verification suite.

---

## 4. Phase 2 — Backend API + accounts (next)

```
mkdir -p backend && cd backend
python3 -m venv venv && source venv/bin/activate
pip install fastapi uvicorn sqlalchemy psycopg2-binary passlib[bcrypt] python-jose[cryptography]
```

Scope: user signup/login, JWT sessions, a `businesses` table (one account can own several businesses — your own workbook already tracks more than one entity), a `qpd_calculations` table storing each quarter's inputs and results, wired to call `zimra_qpd.calculate_qpd()` under the hood. No payments yet — that's Phase 5.

---

## 5. Phase 3 — Web app

Next.js frontend calling the Phase 2 API. Same structure as the original blueprint's Phase 1, now hitting a real backend instead of running calculations client-side.

---

## 6. Phase 4 — Desktop + Android shells

Unchanged from the original blueprint — Tauri for desktop, Capacitor for Android, both wrapping the same web build, both now authenticated against the backend.

---

## 7. Phase 5 — Monetization

- **Free tier:** one business, current-quarter calculation only
- **Paid tier:** multiple businesses, full year history, PDF export of the QPD schedule, payment tracking, deadline reminders (email/WhatsApp) ahead of the 25th of March/June/September and the 20th of December
- **Billing:** Paynow for EcoCash/OneMoney/local card payments, Stripe as an international card fallback
- This phase depends on Phase 2 existing first — you can't track who's paid for what without accounts

---

## 8. What's next

Phase 1 is done and tested. Natural next step is Phase 2 (backend + accounts) whenever you're ready — say the word and I'll scaffold it the same way, working code first, then explaining the structure.

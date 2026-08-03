# ZIMRA QPD Calculator — session handoff (v3, post-Phase 3)

Paste this whole document as your first message in a new chat, along with
re-uploading `zimra_qpd_api.zip` (Phase 2) and `zimra-qpd-web-phase3.zip`
(Phase 3), and Claude can continue exactly where this session left off.

---

## Project
Building a top-quality system (web app, later desktop + Android) that
replaces the user's Excel-based ZIMRA QPD (Quarterly Payment Date
provisional tax) calculator. Python backend, proper accounts/login,
security, and eventually a paid subscription tier (Paynow/EcoCash + Stripe).
Branded **"Twelve C"**, after the ITF12C form it replaces. User is a student
in Zimbabwe building this to be genuinely impressive, not a toy project.

## Status: Phase 1 ✅, Phase 2 ✅, Phase 3 ✅ (unverified — see below), Phase 4 next

### Phase 1 — Calculation engine (done, in `zimra_qpd_api/engine/zimra_qpd/`)
Ported from ITF12C; two workbook bugs fixed (dead `E33` reference, broken
payments section). 13 tests, reconciled to source workbook figures.

### Phase 2 — FastAPI backend (done, in `zimra_qpd_api/`)
FastAPI + async SQLAlchemy + Postgres + Alembic + JWT auth with TOTP MFA +
Argon2id + rate limiting. Endpoints: `/auth/*`, `/businesses`,
`/businesses/{id}/qpd-calculations` (+ `/payments`). 11 tests passing.

### Phase 3 — Next.js web frontend (done, in `zimra-qpd-web/`)
Next.js 14 App Router + TypeScript + Tailwind. Built directly against the
Phase 2 route/schema files field-for-field (not guessed).

**Pages:** landing (`/`), register/login/MFA-challenge (`/register`,
`/login`, `/mfa`), dashboard (`/dashboard`) with multi-business create/list,
business detail (`/dashboard/[businessId]`) with the QPD calculation form,
full results breakdown, calculation history, and payment tracking, and an
account page (`/account`) with TOTP MFA enrollment (QR code) + disable.

**Design system:** named "Twelve C." Custom palette (paper/ink/usd-emerald/
zig-ochre/danger-brick), Fraunces (display) + IBM Plex Sans (body) + IBM
Plex Mono (figures) — deliberately not the cream+terracotta or near-black+
neon AI-design defaults. Signature element: the "Quarterly Rhythm" rail, a
proportional 10/25/30/35 bar with real ZIMRA dates (25 Mar/25 Jun/25 Sep/
20 Dec), reused on the landing hero and the results page with real figures.

**⚠️ CRITICAL — NOT BUILD-VERIFIED:** the sandbox that built Phase 3 had no
network access, so `npm install` / `next build` / any actual render never
ran. The code was hand-reviewed and two real bugs were caught this way
(invalid comma-separated Tailwind arbitrary grid values in two files — both
fixed), but nothing has been compiled. **The very first thing to do in a
new session with network access is:**
```bash
cd zimra-qpd-web
npm install
cp .env.example .env.local
npm run build
```
Fix whatever `npm run build` surfaces — expect small things (an import, a
prop type mismatch), not architectural problems, since all tax math still
lives in the already-tested Phase 1/2 engine.

**Known gaps, already documented in `zimra-qpd-web/README.md`:**
- Tokens stored in `localStorage`, not httpOnly cookies (fine for a demo,
  flag before real users)
- No forgot-password flow (not in the Phase 2 API either)
- No business edit/delete UI (API supports it, frontend doesn't expose it)
- Route protection is client-side only (`AuthGuard`); the API's own
  server-side auth checks are the real enforcement

## Next step: Phase 4 — Desktop (Tauri) + Android (Capacitor) shells
Both just wrap the Phase 3 web build in a webview — nothing in the frontend
needs to change for this. Unchanged from the original blueprint.

## Notes for whoever picks this up
- Don't hardcode ZIMRA rates anywhere new — always route through
  `QpdInput.tax_rate`/`aids_levy_rate` and the business's stored defaults.
- User wants this to eventually generate revenue (Phase 5, Paynow + Stripe)
  — schema already supports it, not built yet.
- User prefers detailed, copy-paste-able, step-by-step instructions and is
  comfortable with "set it up for me" style decisions.
- Before celebrating Phase 3 as "done," get a real `npm run build` pass —
  don't let polish substitute for verification.

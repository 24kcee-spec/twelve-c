# Twelve C — web frontend (Phase 3)

Next.js 14 (App Router) + TypeScript + Tailwind frontend for the ZIMRA QPD
calculator, wired to the Phase 2 FastAPI backend (`zimra_qpd_api`).

## What's here

- **Landing page** (`/`) — the product's thesis: the QPD schedule is 10/25/30/35,
  not four equal chunks, visualised as the "Quarterly Rhythm" rail.
- **Auth**: register (`/register`), login (`/login`), TOTP MFA challenge (`/mfa`),
  matching the backend's `mfa_pending_token` hand-off exactly.
- **Dashboard** (`/dashboard`): create/list businesses (multi-entity).
- **Business detail** (`/dashboard/[businessId]`): the QPD calculation form
  (USD + ZIG sales and deductions), full results breakdown (ratios, adjusted
  income/deductions, tax + AIDS levy, schedule), calculation history, and
  payment tracking that calls `POST /businesses/{id}/qpd-calculations/{id}/payments`.
- **Account** (`/account`): TOTP MFA enrollment with QR code, and disable flow.

Every request shape in `src/lib/types.ts` and `src/lib/api.ts` was written
directly against the Phase 2 route/schema files (`app/api/routes/*.py`,
`app/schemas/*.py`) — field names and endpoint paths match exactly.

## Important — what this session could and couldn't verify

This session doesn't have network or Node access in its sandbox, so **this
code has not been run, built, or type-checked** — no `npm install`, no
`next build`, no browser render. It was written carefully against the actual
Phase 2 schemas rather than guessed, but you should still run a build before
relying on it:

```bash
cd zimra-qpd-web
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at your running API
npm run dev
```

If `npm run build` throws type errors, they're almost certainly small
(an import path, a prop mismatch) — nothing here depends on unverified
business logic, since all the tax math still lives in the Phase 1/2 engine,
not in this frontend.

## Running the full stack together

1. Start the Phase 2 backend (see `zimra_qpd_api/README.md` — Docker Compose
   for Postgres, then `uvicorn app.main:app --reload`).
2. `npm install && npm run dev` here.
3. Visit `http://localhost:3000`, register an account, add a business, run
   a calculation.

## Known gaps (be upfront about these before calling it done)

- **Token storage**: access/refresh tokens are kept in `localStorage` for
  simplicity. That's fine for a student project or early demo, but before
  any real users touch this, move to httpOnly cookies set by a backend
  route so tokens aren't reachable from JS (XSS blast radius).
- **No forgot-password flow** — not in the Phase 2 API yet either.
- **No business edit/delete UI** — the API supports `PATCH`/`DELETE` on
  `/businesses/{id}`, the frontend only exposes create + view so far.
- **No middleware-based route protection** — auth is enforced client-side
  (`AuthGuard`), which is enough to stop casual navigation but not a
  substitute for the API's own auth checks (which are real and enforced
  server-side already).

## Next step: Phase 4

Desktop (Tauri) and Android (Capacitor) shells wrapping this same web build,
per the original blueprint — nothing in this frontend needs to change for
that, since both just point a webview at the built Next.js app.


## Browser-only research study mode

The `/study` route is for approved usability-study sessions. It keeps the
normal registration/login product intact but does not require a participant
account. It is deliberately not wrapped in `AuthGuard`, and `AuthProvider`
skips its refresh-cookie and `/auth/me` requests while this route is active.

- The calculator runs the same Python `calculator.py` and `tax_rules.py`
  from `phase2-backend/engine/zimra_qpd` inside the participant's browser
  using a version-pinned Pyodide runtime.
- The `predev` and `prebuild` scripts copy those source files into
  `public/study-engine` and create a SHA-256 manifest. The manifest shows
  both engine hashes and the Vercel/Git commit used for that build.
- The fictional business, calculation history and explicitly confirmed
  payment records are stored in this browser's `localStorage` only. The
  study route does not call the account, business, calculation or export API.
  The Clear demo data control removes the study data from this browser.
- PDF working papers use the existing client-side PDF generator. Excel
  working papers are assembled and downloaded in the browser. Neither export
  is uploaded.
- The study build does not add analytics or tracking SDKs. The first
  calculation downloads the version-pinned Pyodide runtime and static engine
  source; participant-entered values are not sent to that CDN.

### Locking the study build

Set `NEXT_PUBLIC_STUDY_EXCHANGE_RATE` to the exact independently approved
rate used in the sealed usability task sheet before building. This variable
is mandatory: study mode remains unavailable until the value is configured.
Set the same environment variable in the Vercel project before deployment. Do not change it after the first sealed
session. Any change to the engine, tax rules, exchange rate or study UI
requires a new frozen commit and the relevant sealed tests to be rerun.

Example local setup (run from `phase3-frontend`):

```powershell
$env:NEXT_PUBLIC_STUDY_EXCHANGE_RATE = "YOUR_APPROVED_TASK_5_RATE"
npm install
npm run build
npm run dev
```

Study mode is a research interface, not an alternative account or data-sync
mechanism. A participant's local records do not follow them to another device
or browser profile.

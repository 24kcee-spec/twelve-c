# Twelve C — full project (Phases 1–3)

Everything built so far for the ZIMRA QPD provisional tax calculator, in one
folder. Named after the ITF12C form it replaces.

```
twelve-c/
├── phase1-engine/     Standalone Python calculation engine (pip installable)
├── phase2-backend/    FastAPI + Postgres API with accounts, MFA, saved calcs
│                      (this already contains its own copy of phase1's engine
│                      under phase2-backend/engine/ — that's the one the API
│                      actually imports; phase1-engine/ is kept separately as
│                      the standalone package for anyone who just wants the
│                      pure Python library)
├── phase3-frontend/   Next.js web app that talks to phase2-backend
├── BLUEPRINT.md       Original full-stack plan (Phases 1–5)
└── SESSION_HANDOFF.md Paste this into a new chat to resume work
```

## Status
- **Phase 1 — engine:** done, 13 tests passing (in the original session).
- **Phase 2 — backend:** done, 11 tests passing (in the original session).
- **Phase 3 — frontend:** written, but **not yet build-verified** — see
  `phase3-frontend/README.md`. Run the npm steps below before trusting it.
- **Phase 4 — desktop/Android shells:** not started.
- **Phase 5 — monetization:** not started.

## Running everything together, in order

**1. Backend** (needs Docker, or a local Postgres) — see
`phase2-backend/README.md` for full detail. Short version:
```bash
cd phase2-backend
cp .env.example .env
docker compose up -d          # starts Postgres
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
pip install -e ./engine
alembic upgrade head
uvicorn app.main:app --reload
```
API now running at `http://localhost:8000`.

**2. Frontend** — see the copy-paste guide below.

## Frontend setup, step by step

See the next message for the full walkthrough. Short version:
```bash
cd phase3-frontend
npm install
cp .env.example .env.local
npm run dev
```
Then open `http://localhost:3000`.

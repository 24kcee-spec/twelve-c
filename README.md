# Twelve C

Twelve C is a QPD (Quarterly Payment Date) calculator for Zimbabwe's provisional tax workflow. The repository is intentionally split into phases so the calculation engine, API, and frontend can evolve independently.

## Repository structure

- `phase1-engine/` — Python calculation engine and validation tests
- `phase2-backend/` — FastAPI backend, auth, business models, and persistence
- `phase3-frontend/` — Next.js frontend for the product experience
- `phase4-fiscal/` — fiscal workflow and rule docs
- `diagnostics/` — migration and environment diagnostics

## Important note

This repository contains a legacy root-level `src/` area that is not the active application. The live app is under `phase3-frontend/src`, and the backend is under `phase2-backend/app`.

## Quick start

### Engine

```bash
cd phase1-engine
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m pytest tests/ -v
```

### Backend

```bash
cd phase2-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e ./engine
python -m pytest tests/ -v
```

### Frontend

```bash
cd phase3-frontend
npm install
cp .env.example .env.local
npm run dev
```

## Production-minded guidance

- Treat generated files and local artifacts as disposable.
- Keep business logic in the engine and backend, not in UI code.
- Do not add ad hoc copies of the same app in multiple directories.
- Keep environment variables in `.env` files only and ignore them in git.

## License

This project is for internal product work and early-stage delivery. Check repository settings for current licensing before external distribution.

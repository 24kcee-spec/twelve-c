# ZIMRA QPD Calculator — API (Phase 2)

FastAPI backend wrapping the `zimra_qpd` calculation engine, with accounts,
multi-business support, and TOTP MFA. No payments yet — that's Phase 5.

## Stack

| Layer | Tech |
|---|---|
| API | FastAPI (async) |
| DB | PostgreSQL 16 (via Docker) |
| ORM / migrations | SQLAlchemy 2.0 (async) + Alembic |
| Auth | JWT (access + rotating refresh tokens, server-side revocation) |
| Password hashing | Argon2id |
| MFA | TOTP (RFC 6238), QR-code enrollment |
| Rate limiting | slowapi |

## 1. Prerequisites

- Docker + Docker Compose installed
- Python 3.12 (only needed if you want to run the API outside Docker, or run tests)

## 2. First-time setup

```bash
cd zimra_qpd_api

# Copy the env template and fill in real secrets
cp .env.example .env
```

Open `.env` and set:
- `POSTGRES_PASSWORD` — pick a strong password, then update it in **both**
  `DATABASE_URL` and `DATABASE_URL_SYNC` (same password, three places).
- `JWT_SECRET_KEY` — generate one:
  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(64))"
  ```
- `CORS_ORIGINS` — the URL(s) of your frontend, comma-separated.

## 3. Start Postgres + API with Docker Compose

```bash
docker compose up -d --build
```

This starts Postgres on `localhost:5432` and the API on `localhost:8000`.

## 4. Run the database migration

The schema doesn't exist until you run this once:

```bash
docker compose exec api alembic upgrade head
```

You should see `Running upgrade  -> 61c543a405c6, initial schema: ...`.

## 5. Verify it's alive

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

Interactive API docs: **http://localhost:8000/docs**

## 6. Everyday commands

```bash
# View logs
docker compose logs -f api

# Stop everything (keeps data)
docker compose down

# Stop and wipe the database volume (destructive)
docker compose down -v

# After changing a SQLAlchemy model, generate a new migration
docker compose exec api alembic revision --autogenerate -m "describe the change"
docker compose exec api alembic upgrade head
```

## 7. Running the tests (no Docker needed — uses in-memory SQLite)

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -e ./engine             # makes `zimra_qpd` importable
python3 -m pytest tests/ -v
```

All 11 tests should pass (auth + MFA flow, business ownership isolation,
QPD calculation against the engine, payment tracking).

## 8. API overview

### Auth (`/auth`)
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | email + password (min 12 chars, upper/lower/digit) |
| POST | `/auth/login` | returns tokens, or `{mfa_required: true, mfa_pending_token}` if MFA is on |
| POST | `/auth/mfa/login` | submit `mfa_pending_token` + 6-digit code to finish login |
| POST | `/auth/mfa/setup` | (authenticated) returns QR code + provisioning URI |
| POST | `/auth/mfa/verify` | (authenticated) confirm the 6-digit code to turn MFA on |
| POST | `/auth/mfa/disable` | (authenticated) requires a valid code to turn MFA off |
| POST | `/auth/refresh` | rotates refresh token, returns a new pair |
| POST | `/auth/logout` | revokes one refresh token |
| POST | `/auth/logout/all` | (authenticated) revokes every refresh token for the user |
| GET | `/auth/me` | current user |

### Businesses (`/businesses`)
Standard CRUD, scoped to the authenticated user — one user can own several
businesses; nobody can see or touch another user's businesses (enforced at
the query level, tested in `test_businesses_and_qpd.py`).

### QPD calculations (`/businesses/{business_id}/qpd-calculations`)
- `POST` — runs `zimra_qpd.calculate_qpd()` against submitted sales/expenses
  and persists both the input and full result as JSON.
- `GET` (list / single) — retrieve past calculations.
- `POST /{id}/payments` — records USD/ZIG amounts paid per instalment
  (the working replacement for the workbook's broken payments section).
- `DELETE /{id}`

All endpoints require a Bearer access token and enforce that the calling
user owns the parent business.

## 9. Security notes

- Passwords: Argon2id, never logged, never returned in any response.
- Refresh tokens: only their SHA-256 hash is stored; rotation means a stolen
  refresh token is single-use once the legitimate client refreshes.
- MFA secrets: only committed to `mfa_secret` after a successful verify —
  an abandoned setup never silently enables MFA.
- Rate limiting: register (5/hour/IP), login and MFA login (10/min/IP),
  refresh (30/min/IP).
- CORS is locked to `CORS_ORIGINS` — update it before deploying a frontend.
- Tax rate / AIDS levy rate are never hardcoded — they're per-business
  defaults, overridable per calculation, matching the handoff's requirement
  that this survive future ZIMRA budget changes with zero code changes.

## 10. What's NOT done yet (future phases)

- Email verification / password reset flow (no email provider wired up)
- Payments (Paynow + Stripe) — Phase 5
- Frontend (Next.js) — Phase 3
- Desktop (Tauri) / Android (Capacitor) wrappers — Phase 4

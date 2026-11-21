# Operations Runbook

## First-time setup

```bash
bash scripts/setup-demo.sh          # generates .env with local-only secrets
docker compose -f infra/compose.yaml up --build -d
# migrations/roles/seed against the compose database:
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/becbarrier_dev DATABASE_URL=postgresql://bb_api:bb_api_dev_password@localhost:5432/becbarrier_dev npm run db:migrate && npm run db:setup-roles && npm run db:seed:synthetic
```

Without Docker, point the four `*DATABASE_URL` values in `.env` at a local PostgreSQL 16 and run the same
three npm commands, then start `dev:api`, the uvicorn service and `dev:web`.

## Services & health

| Service | Port | Health |
|---|---|---|
| web | 3000 | HTTP 200 |
| api | 4000 | /api/v1/health, /api/v1/ready |
| email-intelligence | 8001 (internal) | /internal/v1/health |
| postgres / redis | internal | compose healthchecks |

## Worker & retries

The outbox worker claims PENDING rows with SKIP LOCKED, delivers redacted notifications, retries with
bounded exponential backoff (max 5 attempts) and marks permanent failures for operations. Worker outage
never releases or approves anything (tested by T11).

## Backup / restore

`pg_dump -Fc` the database and `pg_restore --no-owner` into a fresh database; T14 verifies histories,
audit chains and replay safety survive. Safe reset: drop and recreate the database, re-run
migrate/setup-roles/seed.

## Demo walkthrough

1. `/login` -> Avery Chen (Finance Initiator, Atlas) -> create a bank change (ON_HOLD).
2. Switch to Blake Ortiz (Supplier Verifier) -> attest CONFIRMED or DENIED on the request.
3. Casey Nakamura + Drew Whitfield (Finance Approvers) approve in sequence -> release.
4. Ellis Marsh (Security Analyst) reviews alerts/cases; Finn Alaric (Auditor) reads the audit chain.

## Environment values

See `.env.example` — placeholders only; secrets are generated locally (`setup-demo.sh`) or injected by the
runtime environment. Production fails closed without OIDC configuration and strong key material.

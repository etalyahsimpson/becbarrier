# Skills Validation

Each technology maps to real source, behavior and an executed test.

| Technology | Where | Behavior | Executed verification |
|---|---|---|---|
| TypeScript | packages/*, apps/api, apps/worker | typed contracts, state machine, worker | `npm run typecheck`, Jest suites |
| Python | services/email-intelligence/app | parser, normalization, rules, FastAPI boundary | `npm run test:python` (pytest) |
| FastAPI + Pydantic | app/main.py, app/schemas.py | internal analyze contract, 401/413/422 | tests/test_api.py |
| Next.js + React | apps/web/src | 8-screen role-aware workbench | `npm run build`, Playwright T12 |
| Tailwind CSS | apps/web/src/app/globals.css | brand system, responsive, reduced-motion | build + e2e |
| TanStack Query | src/lib/session.tsx, screens | server state, invalidation, polling fallback | e2e flows |
| React Hook Form + Zod | bank-change create form | validated business form | e2e Demo B |
| Express | apps/api/src | authoritative REST, middleware chain | integration suites |
| SQL | db/migrations, services/*.ts | schema, constraints, FOR UPDATE locks | integration T05/T08 |
| PostgreSQL | compose + CI service | authoritative store, least-privilege roles | T10 denials |
| Redis | middleware/rate-limit.ts | optional buckets w/ fallback | security suite 429 test |
| WebSockets | services/realtime.ts | tenant-scoped counts | e2e + polling parity |
| AES-256-GCM / HMAC | packages/security | payment crypto, sessions, audit chain | unit crypto-audit suite |
| Pandas + NumPy | scripts/summarize-fixtures.py | deterministic fixture report | CI python job |
| Jest / pytest / Playwright | tests/* | T01-T18 matrix | all suites green |
| Docker/Compose | infra/compose.yaml, Dockerfiles | one-command stack | `docker compose config` in CI |
| Bash | scripts/*.sh | setup, verify, screenshots | verify.sh gates |
| Git/GitHub Actions | .github/workflows/ci.yml | gated CI on push/PR | repository Actions runs |

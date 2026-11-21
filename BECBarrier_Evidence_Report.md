# BECBarrier — Release Evidence Report

**Report status:** FINAL — verified against the live GitHub repository and GitHub Actions.
**Prepared:** 2026-11-21 (CI recovery session).

---

## 1. Publication facts (verified via the GitHub REST API)

| Item | Verified value |
|---|---|
| Repository | https://github.com/etalyahsimpson/becbarrier (public, not private) |
| Owner | `etalyahsimpson` (token-authenticated API identity check) |
| Default branch | `main` |
| Description | "Enterprise business email compromise defense and supplier-payment verification with explainable email indicators, independent callbacks, dual approval and auditable financial controls." |
| Topics | bec, business-email-compromise, cybersecurity, fastapi, nextjs, payment-fraud-prevention, phishing-defense, portfolio-project, postgresql, python, security-engineering, typescript |
| CI workflow | `.github/workflows/ci.yml` (badge in README references this workflow, not a hardcoded image) |
| Reserved portfolio | https://etalyahsimpson.github.io/ — untouched |

## 2. SHA reconciliation (resolves the handoff contradiction)

The handoff contained two different "initial release" SHAs. Verified facts:

- **Actual initial release commit (verified via `git rev-parse` locally AND `GET /repos/…/commits/main` at recovery start):** `44e8a15ed0f515324b180d65cb27a268996875cc`
- The prior `BECBarrier_Evidence_Report.md` working copy cited `44e8a15ed0f5df8eb1a2c9c7f5eab7a2a44e8a15` — **incorrect**, a garbled SHA that never existed in this repository (GitHub returns 404 for it, and the failed run's `head_sha` does not match it).
- Failed run `44878433149` had `head_sha = 44e8a15ed0f515324b180d65cb27a268996875cc`, matching the real initial commit.

## 3. Initial CI failure and diagnosed root causes (from actual job logs)

**Failed run:** https://github.com/etalyahsimpson/becbarrier/actions/runs/44878433149
(head `44e8a15ed0f515324b180d65cb27a268996875cc`, event=push, conclusion=**failure**)

| Job | Failing step | Exact observed error (log) | Verified root cause |
|---|---|---|---|
| Lint, typecheck, unit tests | `Run npm run lint` | 3× eslint `no-unused-vars` (`apps/api/src/middleware/auth.ts:5` `SessionPayload`; `db/seeds/seed.ts:18` `supplierId`; `db/seeds/seed.ts:323` `fingerprint`) | Genuine unused code shipped in the initial commit. (The job also lacked Python, so `npm run lint`'s `ruff` half would have failed next.) |
| Python lint, type, tests, fixture report | `Pytest` | `ModuleNotFoundError: No module named 'app'` (conftest import) | Bare `pytest tests -q` does not add the service root to `sys.path`; the prior session only ever ran `python -m pytest`, which does. Additionally 13 genuine mypy errors were hidden behind `\|\| true`. |
| Browser E2E (T12) | `Prepare database` | `Cannot find module '…/@becbarrier/security/dist/index.js'` | `db:seed:synthetic` imports workspace package `dist` outputs; the job ran `npm ci` without building packages. |
| Integration + security | Jest globalSetup | Same `Cannot find module '@becbarrier/security/dist/index.js'` | Same missing `build:packages` before the seed ran. |

Jobs that passed initially: Production builds, Dependency audit/SBOM/secret scan.

## 4. Corrections applied (this session)

Commits (all on `main`, no force-push):

1. **`b153b4ccfaa6935d370b7904b165dfae20173418`** — main repair commit:
   - Removed the three genuine unused vars (`auth.ts`, `seed.ts`); CI quality job now installs `ruff`.
   - `pythonpath = ["."]` in pytest config (root fix for the import failure); fixed all 13 mypy errors properly (enum-typed `outcome`/`severity`, unused `type: ignore`, list variance) and made mypy a **real gate** (removed `|| true`).
   - `npm run build:packages` added to the integration and E2E jobs before database work.
   - E2E job service-start step rewritten (backgrounded `cd X && cmd &` ran in a subshell and broke the API start path) and now passes `API_UPSTREAM` for the port-4100 API.
   - E2E spec repaired from its never-executed state: login through the web origin (session cookie host mismatch), distinct seeded approvers instead of a colliding role key, explicit `waitForURL` + detail-specific assertions, suppliers selected by label (Demo B previously picked the one supplier without approved contacts), screenshot capture test.
   - Worker-outage test (T11) drains the outbox in a bounded loop instead of assuming two batches clear any backlog.
   - Internal-token test header derived from the environment.
   - Genuine Playwright screenshots captured from the running UI into `assets/screenshots/` and added to the README.
2. **`d0fe4eece24753ce0fedc5b5e6126d69c87dfb61`** — T14 passes parsed PostgreSQL credentials to `pg_dump`/`pg_restore` (CI credentials live in the URL; local trust-auth sockets had masked this).
3. **`f6001869bc0abe8942a6cb6a0af80665f6db1f22`** — regex lint cleanup (eslint `no-useless-escape`); attempted server-matched client tools via apt.
4. **`49b1c0235c457cdd768a7a12d2fb83625ca35eff`** — T14 now runs `pg_dump`/`pg_restore` **inside the postgres:16 service container** via wrapper scripts (`scripts/pg-dump-pg16.sh`, `scripts/pg-restore-pg16.sh`), eliminating host client/server version skew (PG17+ client tools emit `SET transaction_timeout`, rejected by the PG16 server) and the flaky apt dependency. **This commit's CI run passed all jobs.**
5. This evidence-report commit (documentation only).

No security controls were weakened, no tests were removed or skipped to pass, and no `continue-on-error` was introduced.

## 5. Verification results

### Local (executed in the recovery environment)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` (eslint + ruff) | PASS (0 errors) |
| Types (TS) | `npm run typecheck` | PASS |
| Types (Python) | `mypy app` (strict gate) | PASS (0 errors) |
| Unit | `npm run test:unit` | 26/26 PASS |
| Python | `pytest tests` (bare, as CI runs it) and `python -m pytest tests` | 52/52 PASS both ways |
| Integration | `npm run test:integration` | 33/33 PASS (run twice; deterministic) |
| Security | `npm run test:security` | 15/15 PASS |
| Audit chain | `npm run test:audit-verify` | chain=VERIFIED (both tenants) |
| Build | `npm run build` (packages, api, worker, web) | PASS |
| Browser E2E | `npx playwright test --project=chromium` (real Chromium against live PG+FastAPI+Express+Next.js stack) | 2/2 PASS + screenshots captured |

### GitHub Actions (authoritative release gate)

| Run | Head | Conclusion |
|---|---|---|
| 44878433149 | `44e8a15ed0f5…` | failure (initial release) |
| 44880998566 | `b153b4cc…` | failure (T14 pg_dump credentials) |
| 44881285030 | `d0fe4eec…` | failure (T14 client/server version skew; one lint escape) |
| 44881575701 | `f6001869…` | failure (apt client-tools install exit 100) |
| **44881847891** | **`49b1c023…`** | **SUCCESS — all six jobs** (quality, python, integration+security, build, browser E2E, security scans) → https://github.com/etalyahsimpson/becbarrier/actions/runs/44881847891 |
| (this report's commit) | see §1 of the delivery message | verified as the final step of publication — the release claim stands only if this run is also green |

## 6. Honest scope and limitations

- This is an independent engineering portfolio project on synthetic data: no customer deployment, no live fraud-prevention effectiveness or detection-accuracy claims, no publicly hosted SaaS (the publication target is this repository).
- The ERP acknowledgment endpoint is a clearly-marked local contract demonstration; BECBarrier never moves funds.
- The demo identity adapter is development/test-only; production boot fails closed without a real OIDC provider.
- Local E2E used `next dev`; CI E2E runs the same Playwright suite on GitHub-hosted runners with real PostgreSQL and FastAPI services.

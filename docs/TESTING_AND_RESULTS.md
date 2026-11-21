# Testing and Results

All commands run from the repository root on a clean checkout. PostgreSQL (and optionally Redis) are
required for integration/security suites; CI provisions them as service containers.

## Commands

```bash
npm run lint            # eslint + ruff
npm run typecheck       # tsc for api, worker, web, db scripts, tests
npm run test:unit       # Jest unit project
npm run test:python     # pytest (email-intelligence)
npm run test:integration# Jest integration project (runInBand)
npm run test:security   # Jest security project
npm run test:e2e        # Playwright (running seeded stack)
npm run test:audit-verify
npm run build           # packages + api + worker + web production builds
npm run db:migrate && npm run db:setup-roles && npm run db:seed:synthetic
bash scripts/verify.sh  # deterministic local gate sequence
python3 scripts/summarize-fixtures.py   # pandas/numpy fixture report
```

## Acceptance matrix T01-T18

| ID | Coverage |
|---|---|
| T01 | pytest bounded MIME + integration oversize 413 (declared length and streamed cap) |
| T02 | pytest + integration: claimed SPF/DKIM/DMARC PASS persists as UNTRUSTED_CLAIM; SPF UNKNOWN |
| T03 | pytest BEC-01/02/03 contracts incl. approved alias non-flagging |
| T04 | integration: authenticated-looking mail still forces ON_HOLD |
| T05 | scenario BC-N08/N09 + unit state machine: revision voids evidence |
| T06 | scenarios BC-N01..N03: initiator/verifier/duplicate approver denials |
| T07 | scenario BC-N07: number-only-in-email contact 404; BC-N06: fresh contact 422 |
| T08 | concurrency suite: 40+ attempts, exactly-one transitions |
| T09 | tenancy suite: neutral 404s, scoped lists/counts |
| T10 | audit suite: bb_api UPDATE/DELETE denials + tamper detection + CLI exit codes |
| T11 | audit suite: REVOKE-forced audit failure rolls back create; worker never mutates state |
| T12 | Playwright e2e (Demo A blocked, Demo B governed release) |
| T13 | security suite: expired session, CSRF missing/mismatch, disabled membership, downgrade |
| T14 | backup/restore suite: pg_dump/pg_restore parity + chain verify + replay safety |
| T15 | security suite: forged headers ignored, tenant-scoped exports |
| T16 | pytest unsafe HTML/Unicode + integration serialized-payload assertions |
| T17 | bank-changes suite: key reuse with different body 409, no mutation |
| T18 | bank-changes suite: callback expiry blocks approval/release (423), recovery via new revision |

## Fixture totals

- 32 `.eml` fixtures with engine-computed expectations (fixtures/emails/expected.json)
- 26 bank-change scenarios (14 negative, 12 valid/edge) executed by tests/integration/bank-change-scenarios.test.ts
- 40+ concurrency/replay attempts in tests/integration/concurrency.test.ts

## Honest scope

Results demonstrate the stated fixture contracts on synthetic data in the configured environments. They are
not real-world detection-accuracy, fraud-prevention or financial-savings measurements.

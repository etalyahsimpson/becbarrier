# Project Case Study

## Problem
Business Email Compromise exploits normal processes: a plausible invoice or urgent banking-change email
bypasses weak controls. Detection alone cannot authorize payments — a compromised real mailbox passes
every authentication check.

## Solution
BECBarrier couples explainable email-indicator review (BEC-01..07, provenance-aware, UNTRUSTED_CLAIM
handling) with a server-enforced payment guard: mandatory HOLD, independent callback to pre-approved
contacts, dual distinct approval, immutable revisions, idempotent and concurrency-safe transitions, and an
HMAC-chained audit trail — all in one authoritative TypeScript/PostgreSQL core with an isolated Python
analysis service.

## Implementation highlights
- 5 versioned reversible migrations; least-privilege DB roles (proven by permission-denial tests)
- AES-256-GCM bank fields with tenant/supplier/revision AAD binding; keyed equality fingerprints
- 32 email fixtures + 26 executable workflow scenarios + 40+ concurrency attempts, all green
- Full T01-T18 acceptance matrix across pytest / Jest / Playwright
- 8-screen role-aware workbench on Next.js with TanStack Query, RHF+Zod, WS+polling realtime
- One-command Compose stack; gated GitHub Actions CI (quality, python, integration, build, e2e, scans)

## Verifiable evidence
- Repository source and tests (every claim in this case study maps to a file)
- CI workflow runs on the public repo
- Reproducible reports: `python3 scripts/summarize-fixtures.py`, `npm run test:audit-verify`

## Tradeoffs and limits
Conservative similarity thresholds trade recall for precision; no live mailbox/ERP/IdP integrations in this
release; fixture results are not real-world effectiveness claims; audit chaining is tamper-evident against a
bounded threat model. See docs/LIMITATIONS.md.

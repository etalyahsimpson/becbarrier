# Architecture

## Topology

```text
Browser (Next.js 16 / React 19 / TypeScript)
  |  same-origin proxy (/api/v1 rewrite); HttpOnly session cookie + CSRF double-submit
  v
Express API (Node 22 / TypeScript) — AUTHORITATIVE
  |-- AuthN/AuthZ: fresh server-side membership/role/tenant resolution per request
  |-- Email intake -> internal signed call -> FastAPI email-intelligence (Python 3.12)
  |-- Supplier directory / Bank-change state machine / verification / approval / release
  |-- Audit writer + transactional outbox (same PostgreSQL transaction as business writes)
  v
PostgreSQL 16 (tenants, users, suppliers, encrypted accounts, changes, callbacks,
approvals, email samples/findings, alerts, cases, audit chain, outbox, idempotency)
  ^
  |-- Outbox worker (TypeScript, FOR UPDATE SKIP LOCKED, bounded backoff)
  +-- Redis (optional): rate-limit buckets only — never a financial authority
```

## Component boundaries and authority

| Component | Authority | Notes |
|---|---|---|
| Web | none | Renders server state; never enforces permissions |
| Express API | all business state | Only component allowed to transition payment workflow state |
| FastAPI email-intelligence | none | Stateless analysis; no DB writes, no keys, internal network only |
| Worker | outbox delivery only | DB role bb_worker cannot touch business tables |
| Redis | none (ephemeral) | Unavailability degrades rate limiting to in-memory; payments unaffected |

## TypeScript / Python boundary

The Python service was added as a **non-authoritative analysis component** (additive design decision over the
original all-TypeScript handoff topology, preserving every invariant). Express sends the raw bytes (base64),
provenance (`RAW_UPLOAD` / `SYNTHETIC_FIXTURE` only — callers cannot claim `TRUSTED_GATEWAY`) and the
tenant-checked approved supplier domains/aliases. It returns typed findings, normalized metadata, digest,
score and priority. Express persists them transactionally and may raise alerts/cases; findings never
influence release authority (invariant 9).

## Failure modes

| Failure | Behavior |
|---|---|
| email-intelligence down | Uploads return 503 EMAIL_ANALYSIS_UNAVAILABLE; nothing persisted; workflow unaffected |
| Redis down | Rate limiting falls back to in-memory; WebSocket polling fallback authoritative |
| Worker down | Outbox rows stay PENDING; no financial state changes; delivery resumes on recovery |
| Audit write fails | Whole transaction rolls back — no partial business transition (invariant 7) |
| DB down | Readiness flips; API refuses to boot; no cached authorization anywhere |

## Data flow example (email upload)

1. `POST /api/v1/email-samples` (raw `.eml`, size-capped, content-length pre-check).
2. Express loads approved domains for the tenant from PostgreSQL (never from the client).
3. Signed internal call to `POST /internal/v1/analyze-email` with the service token.
4. Python parses with hard bounds (parts/nesting/headers/sizes), normalizes IDNA domains,
   evaluates BEC-01..07 deterministically, computes the capped triage score.
5. Express persists sample + findings + alert (+ case for HIGH/CRITICAL) with audit event
   and outbox event in one transaction; publishes realtime stats.

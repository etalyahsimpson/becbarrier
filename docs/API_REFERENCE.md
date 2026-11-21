# API Reference

OpenAPI 3.1 document is served live at `GET /api/v1/openapi.json`; a tested Postman collection ships at
`postman/BECBarrier.postman_collection.json`.

## Conventions

- Auth: `bb_session` HttpOnly cookie (demo adapter in dev/test; OIDC-ready for production).
- CSRF: `X-CSRF-Token` header (double-submit bound to the session) on all state-changing requests except login/logout.
- Idempotency: `Idempotency-Key` header (8-128 chars) required on governed POSTs; replays return the
  original outcome; key reuse with a different body returns 409.
- Errors: `{"error":{"code","message"},"correlationId"}` with codes MALFORMED_INPUT(400), UNAUTHENTICATED(401),
  FORBIDDEN(403), NOT_FOUND_IN_TENANT(404), STALE_REVISION/IDEMPOTENCY_CONFLICT(409), PAYLOAD_TOO_LARGE(413),
  INVALID_TRANSITION/VERIFICATION_REQUIRED(422), VERIFICATION_HOLD(423), RATE_LIMITED(429), TEMPORARILY_UNAVAILABLE(503).
- Cross-tenant identifiers always answer 404, never disclosing existence.

## Endpoints

| Method & path | Purpose |
|---|---|
| GET /api/v1/health · /ready | no-secret liveness; readiness fails when DB is down |
| GET/POST /api/v1/auth/* | demo identities, demo-login (dev/test), logout, me |
| POST /api/v1/email-samples | one `.eml` <= 2 MiB (raw rfc822 or JSON base64) -> findings/alerts/cases |
| GET /api/v1/email-samples[/:id] | tenant-scoped samples / normalized detail with findings |
| GET /api/v1/alerts | filterable, paginated alert feed |
| GET /api/v1/cases[/:id] · POST /api/v1/cases/:id/events | case detail/timeline; analyst events with version precondition |
| GET /api/v1/suppliers[/:id] · POST /api/v1/suppliers/:id/contacts | directory + masked references; audited contact approval |
| POST /api/v1/suppliers/:id/bank-changes | create -> mandatory ON_HOLD revision 1 |
| GET /api/v1/bank-changes[/:id] | masked before/after, callback, decisions, revisions, audit timeline |
| POST /api/v1/bank-changes/:id/verify | independent callback attestation (approved contact, exact revision) |
| POST /api/v1/bank-changes/:id/decisions | distinct APPROVE/REJECT for the exact revision |
| POST /api/v1/bank-changes/:id/release | -> RELEASED_FOR_ERP_UPDATE + controlled instruction |
| POST /api/v1/bank-changes/:id/erp-ack | authenticated ERP acknowledgment (local contract demo; X-ERP-Ack secret) |
| POST /api/v1/bank-changes/:id/revisions | material edit -> new immutable revision, evidence void |
| POST /api/v1/bank-changes/:id/cancel | initiator/admin cancel |
| GET /api/v1/audit-events | tenant-scoped redacted audit history (auditor/admin) |
| GET /api/v1/reports/summary[?format=csv] | real persisted statistics; redacted CSV export |
| GET /api/v1/realtime/summary | polling fallback for WS counts |

## Internal FastAPI boundary (not exposed to browsers)

`POST /internal/v1/analyze-email` — authenticated with `X-Internal-Service-Token`; accepts base64 content,
provenance (RAW_UPLOAD | SYNTHETIC_FIXTURE only), approved domains/aliases; returns digest, parse status,
normalized fields, BEC-01..07 findings, score, priority, unknown count. 413 oversize, 422 malformed input.
`GET /internal/v1/health` is unauthenticated. The service holds no secrets besides its token, writes no
database rows and cannot approve anything.

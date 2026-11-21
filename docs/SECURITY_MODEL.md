# Security Model

## The ten hard invariants (all enforced server-side, all under negative tests)

1. Every new supplier bank-account instruction enters ON_HOLD before it can affect payment records (BEC-08).
2. Passing email authentication never approves payment details (T02, T04).
3. Callback contacts must come from the approved directory and pre-date the request (T07).
4. Initiator, verifier, approver 1 and approver 2 are four distinct eligible identities (T06).
5. Callback and approvals bind the exact immutable revision; material edits void prior evidence (T05).
6. Tenant membership, role and account status are re-resolved server-side on every action (T13).
7. Business transition + audit event + outbox event commit or roll back atomically (T11).
8. Outages, expiry, stale versions and ambiguity preserve HOLD / fail closed (T18).
9. Email risk scores are advisory; only the governed workflow can release (T04).
10. No cross-tenant reads, counts, mutations or exports (T09, T15).

## Role matrix (enforced by requireRole + domain policies)

| Role | May | May not |
|---|---|---|
| Finance Initiator | create bank changes, cancel own | verify/approve own or any |
| Supplier Verifier | attest callbacks for others | initiate, approve |
| Finance Approver | approve/reject verified revisions | approve own/initiation/verification or twice |
| Security Analyst | alerts, cases, notes, redacted exports | edit supplier accounts, release |
| Auditor | read-only history, controlled export | change anything |
| Tenant Admin | memberships, contact policy (audited) | bypass callbacks, impersonate, waive separation |

## Identity boundary

- Development/test: local demo adapter (`/api/v1/auth/demo-login`) with synthetic users; disabled unless
  `APP_ENV` is development/test.
- Production: `loadConfig` **fails closed** without `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`. An OIDC
  authorization-code + PKCE adapter is implemented for later wiring; nothing is simulated as operational.

## Session & request defenses

HMAC-signed stateless session cookie (HttpOnly, SameSite=Lax, Secure in production) + CSRF double-submit
token bound to the session id; roles/tenants always re-resolved from PostgreSQL per request; structured
error envelopes with correlation ids; strict security headers (CSP `default-src 'none'` on API responses);
request throttling (Redis or in-memory fallback); bounded pagination; Idempotency-Key on governed POSTs.

## Tenant isolation

Every query filters `tenant_id` together with the object id; cross-tenant UUIDs return neutral 404s.
Least-privilege DB roles: `bb_api` (no UPDATE/DELETE on audit_events or bank_change_revisions), `bb_worker`
(outbox only), `bb_audit_ro` (read-only).

## Bounded audit claim

Audit rows are append-only for the application role and HMAC-chained per tenant. This deters ordinary
application-level tampering; it is NOT absolute immutability against an attacker holding both the database
and the audit key (see THREAT_MODEL residual risks).

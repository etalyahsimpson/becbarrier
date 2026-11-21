# Engineering Decisions

| Decision | Rationale |
|---|---|
| Add a Python/FastAPI email-intelligence service | The core product needs hardened, well-tested MIME parsing and deterministic rule evaluation; Python's stdlib email parsing plus Pydantic contracts give that with clear isolation. It is strictly non-authoritative: no DB writes, no keys, no release power — preserving every handoff invariant while satisfying the Python requirement. |
| Express owns all state | One authoritative transaction boundary keeps state transitions, audit and outbox atomic (invariant 7). Splitting authority across languages would multiply failure modes. |
| PostgreSQL as the only source of truth | Transactions, row locks (FOR UPDATE), composite uniqueness and enum constraints are exactly the financial-control primitives needed. No ORM — explicit parameterized SQL keeps every query auditable. |
| Redis is optional/ephemeral | Requested stack item used honestly: rate-limit buckets with in-memory fallback. It never holds financial or audit truth; its outage changes nothing about payments (tested). |
| WebSockets with polling fallback | Live alert counts are useful; correctness must not depend on them. The polling endpoint returns identical committed state. |
| No Celery | The TypeScript worker already consumes the transactional outbox with SKIP LOCKED claiming; a second queue system would duplicate authority and add failure modes. |
| No AI/ML model in MVP | The problem is workflow enforcement, not prediction. Deterministic, explainable rules with explicit UNKNOWN outcomes match the handoff; calibrated analytics are a documented future item requiring lawful datasets. |
| Immutable revision table instead of mutating proposals | The handoff requires revisions that never overwrite approved history; a separate append-only table (with revokes for the app role) enforces it at the grant level. |
| HMAC fingerprints, not plain hashes | Account numbers are low-entropy; unkeyed hashes are trivially reversible. Keyed comparison fingerprints are the handoff requirement and cheap to verify. |
| Demo identity adapter instead of a fake IdP | An honest boundary: clearly labeled, environment-gated, and production fails closed without real OIDC. Nothing pretends to be enterprise authentication. |
| ERP ack as a local contract demo | The exact-revision acknowledgment contract is real and tested; claiming a live ERP integration without credentials would be dishonest. |

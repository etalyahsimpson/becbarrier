# Financial Workflow

## State machine

```text
DRAFT -> SUBMITTED -> ON_HOLD -> CALLBACK_VERIFIED -> APPROVAL_1 -> APPROVAL_2
      -> RELEASED_FOR_ERP_UPDATE -> ERP_APPLIED (authenticated acknowledgment only)

ON_HOLD / CALLBACK_VERIFIED / APPROVAL_* -> REJECTED | CANCELLED | EXPIRED
ANY material edit -> new immutable revision -> ON_HOLD (prior callback/approvals void)
ANY error, stale version or missing evidence -> NO release, NO advancement
```

API creation lands directly in `ON_HOLD` revision 1 (handoff transition table).

## Callback protocol (handoff 5.2)

1. Verifier selects an approved directory contact; a number appearing only in the requesting email can
   never satisfy this (404 / 422 VERIFICATION_REQUIRED, T07).
2. The contact must have been established before the request was created (invariant 3).
3. The verifier actively attests CONFIRMED / DENIED / UNREACHABLE against the exact revision, capturing
   channel, timestamp, expiry (default 72h, server-clock only) and a redacted evidence reference.
4. DENIED rejects the request; UNREACHABLE records the attempt and preserves ON_HOLD; CONFIRMED advances
   to CALLBACK_VERIFIED. The application never places calls or claims one happened.

## Dual approval and release

Approvals require role FINANCE_APPROVER and differ from initiator, verifier and each other (403
SEPARATION_OF_DUTIES otherwise). Release requires APPROVAL_2 + a current callback + exactly two distinct
approvals for the exact revision, checked inside the row lock; success writes the transition, audit event
and release-instruction outbox event in ONE transaction. The release is an instruction for an external,
separately authorized ERP update — BECBarrier never moves funds.

## Revisions, idempotency, concurrency

- Material edits (`POST /bank-changes/:id/revisions`) require the expected revision, create revision N+1,
  return the request to ON_HOLD and void prior evidence (T05); non-material edits are rejected.
- Governed POSTs require an Idempotency-Key: identical replays return the original outcome; key reuse with
  a different body returns 409 IDEMPOTENCY_CONFLICT with no mutation (T17).
- All transitions run in `SELECT ... FOR UPDATE` transactions with re-verified eligibility inside the lock;
  races yield exactly one transition (T08, 40+ attempts).

## Expiry

Callbacks expire after 72h (server-side); expiry blocks approvals/release with 423 VERIFICATION_HOLD and
never auto-revalidates (T18). Requests past the tenant policy age are expired by a deterministic sweep with
audit events — timers never release anything.

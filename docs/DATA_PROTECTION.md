# Data Protection

## Payment data lifecycle

1. Plaintext proposed bank fields exist only in request memory and are validated by Zod.
2. They are encrypted with **AES-256-GCM** (unique 12-byte nonce, 128-bit tag) where the AAD binds
   `tenant|supplier|revision` context; ciphertext under a mismatched context fails to decrypt.
3. Only the envelope (version, keyId, base64 nonce+ciphertext+tag, context digest) is stored — never the key.
4. Equality comparisons use **HMAC-SHA-256 keyed fingerprints** over canonical identifiers (spaces stripped,
   upper-cased) — unkeyed hashes of low-entropy account numbers are explicitly rejected.
5. UI, logs, events and exports only ever see masked suffixes (`.... 2233`) plus non-reversible references.

## Key management

Keys are 32-byte hex values injected via environment (`SESSION_SIGNING_KEY`, `PAYMENT_ENCRYPTION_KEY`,
`AUDIT_HMAC_KEY`); production startup refuses weak/missing keys. Demo keys are generated per-environment by
`scripts/setup-demo.sh` and never committed. Key rotation would use the stored `key_id` to re-encrypt; the
initial release ships a single key version and documents rotation as an operational procedure.

## Least privilege

`bb_api` holds standard DML on business tables but only INSERT/SELECT on `audit_events` and
`bank_change_revisions` (append-only financial history — proven by T10 denials); `bb_worker` touches only
`outbox_events`; `bb_audit_ro` is read-only.

## Audit integrity (bounded claim)

Per-tenant ordered events with `sequence`, `prev_event_hash` and `event_hmac = HMAC-SHA-256(key, canonical(event))`.
The verifier (`npm run test:audit-verify`) recomputes chains and detects edits/gaps; a failed audit write
aborts the associated financial transaction. An attacker with simultaneous database and key access could
rewrite a chain — external write-once retention is the production hardening path.

## Retention

Synthetic demo data only. Email raw bytes are not persisted (digest + bounded metadata + redacted excerpts
only); fixtures may retain full content in development, per the handoff retention policy versioning.

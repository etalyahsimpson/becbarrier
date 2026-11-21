-- +migrate Up
-- Audit chain, transactional outbox and idempotency records.
-- audit_events: append-only for the application role (INSERT/SELECT only);
-- the audit sequence row is locked inside each business transaction so the
-- chain order is deterministic per tenant.

CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  safe_metadata JSONB NOT NULL DEFAULT '{}',
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  prev_event_hash TEXT NOT NULL,
  event_hmac TEXT NOT NULL,
  key_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sequence)
);
CREATE INDEX idx_audit_tenant_time ON audit_events(tenant_id, event_time DESC);
CREATE INDEX idx_audit_aggregate ON audit_events(tenant_id, aggregate_type, aggregate_id);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  business_event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  redacted_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_FLIGHT','DELIVERED','FAILED')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_event_id)
);
CREATE INDEX idx_outbox_pending ON outbox_events(status, next_attempt_at) WHERE status IN ('PENDING','IN_FLIGHT');

CREATE TABLE idempotency_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_digest TEXT NOT NULL,
  response_status INT,
  response_body JSONB,
  response_ref UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, actor_user_id, endpoint, idempotency_key)
);

-- +migrate Down
DROP TABLE idempotency_records;
DROP TABLE outbox_events;
DROP TABLE audit_events;

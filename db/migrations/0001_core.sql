-- +migrate Up
-- Core identity and tenancy. All tenant-owned rows carry tenant_id and are
-- filtered by tenant_id + object id together in every query.

CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  callback_expiry_hours INT NOT NULL DEFAULT 72,
  request_expiry_days INT NOT NULL DEFAULT 14,
  retention_policy_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  oidc_issuer TEXT,
  oidc_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN
    ('FINANCE_INITIATOR','SUPPLIER_VERIFIER','FINANCE_APPROVER','SECURITY_ANALYST','AUDITOR','TENANT_ADMIN')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  permission_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, role)
);
CREATE INDEX idx_memberships_user ON memberships(user_id) WHERE active;

-- Per-tenant monotonic audit sequence counter (row locked inside the
-- business transaction so audit order is deterministic).
CREATE TABLE audit_sequences (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  last_sequence BIGINT NOT NULL DEFAULT 0
);

-- +migrate Down
DROP TABLE audit_sequences;
DROP TABLE memberships;
DROP TABLE users;
DROP TABLE tenants;

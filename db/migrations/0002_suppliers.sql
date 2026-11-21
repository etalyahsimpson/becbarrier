-- +migrate Up
-- Supplier master data: approved domains/aliases, pre-approved callback
-- contacts, encrypted payment accounts with HMAC fingerprints.

CREATE TABLE suppliers (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  canonical_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','RETIRED')),
  approved_domains JSONB NOT NULL DEFAULT '[]',
  approved_domains_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, canonical_name)
);

-- Approved callback contacts. `contact_established_at` must pre-date any
-- bank-change request that cites this contact (enforced in the transaction,
-- invariant 3). The plaintext contact value is only ever stored encrypted.
CREATE TABLE supplier_contacts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('PHONE','EMAIL')),
  encrypted_contact_value JSONB NOT NULL,
  contact_fingerprint TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  contact_label TEXT NOT NULL,
  contact_established_at TIMESTAMPTZ NOT NULL,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  provenance TEXT NOT NULL CHECK (provenance IN ('DIRECTORY_SEED','VERIFIED_UPDATE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, contact_fingerprint)
);
CREATE INDEX idx_contacts_supplier ON supplier_contacts(supplier_id) WHERE active;

-- Payment accounts. Raw values only in AES-256-GCM envelopes; equality via
-- keyed HMAC-SHA-256 fingerprints; UI gets masked suffix only.
CREATE TABLE supplier_payment_accounts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  encrypted_bank_payload JSONB NOT NULL,
  fingerprint TEXT NOT NULL,
  key_id TEXT NOT NULL,
  masked_suffix TEXT NOT NULL,
  beneficiary_mask TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  approved_version INT NOT NULL DEFAULT 1,
  active_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_payment_accounts_active_fp
  ON supplier_payment_accounts(tenant_id, fingerprint) WHERE active_to IS NULL;
CREATE INDEX idx_payment_accounts_supplier ON supplier_payment_accounts(supplier_id);

-- +migrate Down
DROP TABLE supplier_payment_accounts;
DROP TABLE supplier_contacts;
DROP TABLE suppliers;

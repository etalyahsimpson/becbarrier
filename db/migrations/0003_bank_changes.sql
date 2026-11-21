-- +migrate Up
-- The governed bank-change workflow. Requests advance through a typed state
-- machine; every material edit creates a new immutable revision row and prior
-- callback/approval evidence is only ever read for the CURRENT revision.

CREATE TABLE bank_change_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  initiator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN
    ('DRAFT','SUBMITTED','ON_HOLD','CALLBACK_VERIFIED','APPROVAL_1','APPROVAL_2',
     'RELEASED_FOR_ERP_UPDATE','ERP_APPLIED','REJECTED','CANCELLED','EXPIRED')),
  revision INT NOT NULL CHECK (revision > 0),
  old_account_id UUID REFERENCES supplier_payment_accounts(id) ON DELETE RESTRICT,
  old_fingerprint TEXT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason TEXT NOT NULL,
  linked_email_sample_id UUID,
  callback_expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  released_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  release_ref UUID,
  erp_applied_at TIMESTAMPTZ,
  erp_receipt_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_changes_tenant_state ON bank_change_requests(tenant_id, state);
CREATE INDEX idx_changes_supplier ON bank_change_requests(supplier_id);

-- Immutable per-revision proposed values (append-only; no UPDATE/DELETE grants).
CREATE TABLE bank_change_revisions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  change_id UUID NOT NULL REFERENCES bank_change_requests(id) ON DELETE RESTRICT,
  revision INT NOT NULL CHECK (revision > 0),
  proposed_ciphertext JSONB NOT NULL,
  proposed_fingerprint TEXT NOT NULL,
  beneficiary_mask TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  masked_suffix TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (change_id, revision)
);

-- Callback attestations. Positive verification unique per revision.
CREATE TABLE callback_verifications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  change_id UUID NOT NULL REFERENCES bank_change_requests(id) ON DELETE RESTRICT,
  revision INT NOT NULL CHECK (revision > 0),
  verifier_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_contact_id UUID NOT NULL REFERENCES supplier_contacts(id) ON DELETE RESTRICT,
  result TEXT NOT NULL CHECK (result IN ('CONFIRMED','DENIED','UNREACHABLE')),
  method TEXT NOT NULL CHECK (method = 'APPROVED_DIRECTORY_CONTACT'),
  evidence_ref TEXT NOT NULL,
  notes TEXT,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (change_id, revision, verifier_user_id, result)
);
CREATE UNIQUE INDEX idx_callback_positive_once
  ON callback_verifications(change_id, revision) WHERE result = 'CONFIRMED';

-- Approval decisions. APPROVE occupies sequence 1 or 2; REJECT records a
-- terminal decision without a sequence slot.
CREATE TABLE approval_decisions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  change_id UUID NOT NULL REFERENCES bank_change_requests(id) ON DELETE RESTRICT,
  revision INT NOT NULL CHECK (revision > 0),
  approver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  sequence INT CHECK (sequence IN (1,2)),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (change_id, revision, approver_user_id),
  CHECK ((decision = 'APPROVE' AND sequence IS NOT NULL)
      OR (decision = 'REJECT' AND sequence IS NULL))
);
CREATE UNIQUE INDEX idx_approval_sequence_once
  ON approval_decisions(change_id, revision, sequence) WHERE decision = 'APPROVE';

-- +migrate Down
DROP TABLE approval_decisions;
DROP TABLE callback_verifications;
DROP TABLE bank_change_revisions;
DROP TABLE bank_change_requests;

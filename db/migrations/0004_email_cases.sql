-- +migrate Up
-- Email samples, rule findings, alerts and investigation cases.

CREATE TABLE email_samples (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_digest TEXT NOT NULL CHECK (char_length(source_digest) = 64),
  provenance TEXT NOT NULL CHECK (provenance IN
    ('TRUSTED_GATEWAY','RAW_UPLOAD','SYNTHETIC_FIXTURE','UNDETERMINED')),
  parse_status TEXT NOT NULL CHECK (parse_status IN ('OK','MALFORMED','REJECTED_OVERSIZE','UNKNOWN')),
  parsed_headers_json JSONB NOT NULL,
  normalized_fields_json JSONB NOT NULL,
  rule_version TEXT NOT NULL,
  score INT NOT NULL CHECK (score >= 0 AND score <= 100),
  priority TEXT CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  unknown_count INT NOT NULL DEFAULT 0,
  subject_display TEXT NOT NULL DEFAULT '(no subject)',
  uploader_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_digest)
);

CREATE TABLE email_findings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email_sample_id UUID NOT NULL REFERENCES email_samples(id) ON DELETE RESTRICT,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('MATCH','NO_MATCH','UNKNOWN')),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  provenance TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence_field TEXT,
  masked_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_findings_sample ON email_findings(email_sample_id);

CREATE TABLE alerts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email_sample_id UUID REFERENCES email_samples(id) ON DELETE RESTRICT,
  change_id UUID REFERENCES bank_change_requests(id) ON DELETE RESTRICT,
  case_id UUID,
  priority TEXT NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  title TEXT NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]',
  disposition TEXT NOT NULL DEFAULT 'OPEN' CHECK (disposition IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_tenant ON alerts(tenant_id, disposition, created_at DESC);

CREATE TABLE cases (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','ESCALATED','CLOSED')),
  priority TEXT CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  assignee_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  linked_change_id UUID REFERENCES bank_change_requests(id) ON DELETE RESTRICT,
  linked_email_sample_id UUID REFERENCES email_samples(id) ON DELETE RESTRICT,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_tenant ON cases(tenant_id, status);

CREATE TABLE case_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('COMMENT','ASSIGN','DISPOSITION','LINK','CREATE')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_case_events_case ON case_events(case_id, created_at);

-- +migrate Down
DROP TABLE case_events;
DROP TABLE cases;
DROP TABLE alerts;
DROP TABLE email_findings;
DROP TABLE email_samples;

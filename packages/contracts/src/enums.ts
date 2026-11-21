/**
 * Shared enums and literals for BECBarrier.
 * These values are the single source of truth for both the TypeScript
 * services and (mirrored in Pydantic) the Python email-intelligence service.
 */

/** Roles from the role matrix (handoff section 4.3). */
export const ROLES = [
  'FINANCE_INITIATOR',
  'SUPPLIER_VERIFIER',
  'FINANCE_APPROVER',
  'SECURITY_ANALYST',
  'AUDITOR',
  'TENANT_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

/** Supplier bank-change request states (handoff section 5.1). */
export const CHANGE_STATES = [
  'DRAFT',
  'SUBMITTED',
  'ON_HOLD',
  'CALLBACK_VERIFIED',
  'APPROVAL_1',
  'APPROVAL_2',
  'RELEASED_FOR_ERP_UPDATE',
  'ERP_APPLIED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type ChangeState = (typeof CHANGE_STATES)[number];

export const TERMINAL_STATES: readonly ChangeState[] = [
  'ERP_APPLIED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;

/** Email sample provenance grades (handoff section 3.3). */
export const PROVENANCE_GRADES = [
  'TRUSTED_GATEWAY',
  'RAW_UPLOAD',
  'SYNTHETIC_FIXTURE',
  'UNDETERMINED',
] as const;
export type ProvenanceGrade = (typeof PROVENANCE_GRADES)[number];

/** Rule outcomes. */
export const RULE_OUTCOMES = ['MATCH', 'NO_MATCH', 'UNKNOWN'] as const;
export type RuleOutcome = (typeof RULE_OUTCOMES)[number];

/** Finding severities and the illustrative prioritization weights. */
export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  INFO: 0,
  LOW: 10,
  MEDIUM: 25,
  HIGH: 45,
  CRITICAL: 70,
};

/** Deterministic rule identifiers for the initial release. */
export const RULE_IDS = ['BEC-01', 'BEC-02', 'BEC-03', 'BEC-04', 'BEC-05', 'BEC-06', 'BEC-07'] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const RULESET_VERSION = 'bec-rules-v1';

/** Callback verification outcomes. */
export const CALLBACK_RESULTS = ['CONFIRMED', 'DENIED', 'UNREACHABLE'] as const;
export type CallbackResult = (typeof CALLBACK_RESULTS)[number];

/** Approval decisions. */
export const DECISIONS = ['APPROVE', 'REJECT'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Alert priorities derived from the capped score bands. */
export const ALERT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AlertPriority = (typeof ALERT_PRIORITIES)[number];

/** Case lifecycle. */
export const CASE_STATUSES = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'CLOSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Structured error codes used across the REST API. */
export const ERROR_CODES = [
  'MALFORMED_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND_IN_TENANT',
  'STALE_REVISION',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'INVALID_TRANSITION',
  'VERIFICATION_REQUIRED',
  'VERIFICATION_HOLD',
  'SEPARATION_OF_DUTIES',
  'RATE_LIMITED',
  'TEMPORARILY_UNAVAILABLE',
  'EMAIL_ANALYSIS_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Status-code mapping for the structured error envelope. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  MALFORMED_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND_IN_TENANT: 404,
  STALE_REVISION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_TRANSITION: 422,
  VERIFICATION_REQUIRED: 422,
  VERIFICATION_HOLD: 423,
  SEPARATION_OF_DUTIES: 403,
  RATE_LIMITED: 429,
  TEMPORARILY_UNAVAILABLE: 503,
  EMAIL_ANALYSIS_UNAVAILABLE: 503,
};

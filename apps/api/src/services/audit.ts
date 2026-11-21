import { appendAuditEvent as append } from '@becbarrier/security';
import type { AppConfig } from '../config.js';

export { appendAuditEvent } from '@becbarrier/security';

/** Compatibility wrapper for existing call sites that pass AppConfig. */
export async function appendAuditEventWithConfig(
  client: Parameters<typeof append>[0],
  config: AppConfig,
  input: Parameters<typeof append>[2],
): Promise<{ eventId: string; sequence: number }> {
  return append(client, config.auditHmacKey, input);
}

/** Audit event types emitted by the application. */
export const AuditEventTypes = {
  EMAIL_SAMPLE_INGESTED: 'EMAIL_SAMPLE_INGESTED',
  ALERT_CREATED: 'ALERT_CREATED',
  CASE_CREATED: 'CASE_CREATED',
  CASE_EVENT_APPENDED: 'CASE_EVENT_APPENDED',
  BANK_CHANGE_CREATED: 'BANK_CHANGE_CREATED',
  BANK_CHANGE_HOLD: 'BANK_CHANGE_HOLD',
  CALLBACK_ATTESTED: 'CALLBACK_ATTESTED',
  CALLBACK_DENIED: 'CALLBACK_DENIED',
  CALLBACK_UNREACHABLE: 'CALLBACK_UNREACHABLE',
  DECISION_RECORDED: 'DECISION_RECORDED',
  REVISION_CREATED: 'REVISION_CREATED',
  BANK_CHANGE_RELEASED: 'BANK_CHANGE_RELEASED',
  ERP_ACK_RECORDED: 'ERP_ACK_RECORDED',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  CONTACT_APPROVED: 'CONTACT_APPROVED',
  MEMBERSHIP_UPDATED: 'MEMBERSHIP_UPDATED',
  ACCESS_DENIED: 'ACCESS_DENIED',
} as const;

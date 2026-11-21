import { randomUUID } from 'node:crypto';
import type { DbClient } from '../db.js';

/**
 * Transactional outbox writer. One unique outbox row is inserted in the SAME
 * transaction as the business transition; the worker later delivers it. A
 * duplicate worker attempt can never create an additional business action —
 * the outbox row is unique per business_event_id.
 */

export interface OutboxInput {
  tenantId: string;
  eventType: string;
  redactedPayload: Record<string, unknown>;
  businessEventId?: string;
}

export const OutboxEventTypes = {
  BANK_CHANGE_CREATED: 'bank.change.created',
  BANK_CHANGE_HOLD: 'bank.change.hold',
  CALLBACK_ATTESTED: 'bank.change.callback_attested',
  CALLBACK_DENIED: 'bank.change.callback_denied',
  DECISION_RECORDED: 'bank.change.decision_recorded',
  REVISION_CREATED: 'bank.change.revision_created',
  RELEASE_INSTRUCTION: 'bank.change.release_instruction',
  ERP_ACK: 'bank.change.erp_ack',
  REQUEST_TERMINAL: 'bank.change.terminal',
  EMAIL_SAMPLE_ANALYZED: 'email.sample.analyzed',
  ALERT_CREATED: 'alert.created',
  CASE_EVENT: 'case.event_appended',
  CONTACT_APPROVED: 'supplier.contact_approved',
} as const;

export async function insertOutboxEvent(client: DbClient, input: OutboxInput): Promise<string> {
  const id = input.businessEventId ?? randomUUID();
  await client.query(
    `INSERT INTO outbox_events (id, tenant_id, business_event_id, event_type, redacted_payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.tenantId, id, input.eventType, JSON.stringify(input.redactedPayload)],
  );
  return id;
}

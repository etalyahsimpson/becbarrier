import { randomUUID } from 'node:crypto';
import { auditKeyVersion, computeEventHmac, GENESIS_HASH } from './audit-chain.js';

/**
 * Transactional audit writer usable by both the API and the seed tooling.
 * MUST be called inside the same PostgreSQL transaction as the business
 * mutation: if the audit append fails, the whole transaction rolls back
 * (invariant 7). The per-tenant sequence row is locked so chain order is
 * deterministic.
 */

export interface AuditWriterClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface AuditInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  actorUserId: string | null;
  eventType: string;
  safeMetadata: Record<string, unknown>;
  eventTime?: Date;
}

export async function appendAuditEvent(
  client: AuditWriterClient,
  auditKeyHex: string,
  input: AuditInput,
): Promise<{ eventId: string; sequence: number }> {
  const eventTime = (input.eventTime ?? new Date()).toISOString();
  const seqResult = await client.query<{ last_sequence: string }>(
    `UPDATE audit_sequences SET last_sequence = last_sequence + 1
     WHERE tenant_id = $1
     RETURNING last_sequence`,
    [input.tenantId],
  );
  let sequence: number;
  if (seqResult.rows[0]) {
    sequence = Number(seqResult.rows[0].last_sequence);
  } else {
    const ins = await client.query<{ last_sequence: string }>(
      `INSERT INTO audit_sequences (tenant_id, last_sequence) VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET last_sequence = audit_sequences.last_sequence + 1
       RETURNING last_sequence`,
      [input.tenantId],
    );
    sequence = Number(ins.rows[0]!.last_sequence);
  }

  const prevResult = await client.query<{ event_hmac: string }>(
    `SELECT event_hmac FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 1`,
    [input.tenantId],
  );
  const prevEventHash = prevResult.rows[0]?.event_hmac ?? GENESIS_HASH;

  const eventId = randomUUID();
  const eventHmac = computeEventHmac(auditKeyHex, {
    id: eventId,
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    eventTime,
    safeMetadata: input.safeMetadata,
    sequence,
    prevEventHash,
  });

  await client.query(
    `INSERT INTO audit_events (id, tenant_id, aggregate_type, aggregate_id, aggregate_version,
                               actor_user_id, event_type, event_time, safe_metadata, sequence,
                               prev_event_hash, event_hmac, key_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      eventId,
      input.tenantId,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      input.actorUserId,
      input.eventType,
      eventTime,
      JSON.stringify(input.safeMetadata),
      sequence,
      prevEventHash,
      eventHmac,
      auditKeyVersion(),
    ],
  );

  return { eventId, sequence };
}

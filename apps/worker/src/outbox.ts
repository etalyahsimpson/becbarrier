import pg from 'pg';

/**
 * Transactional-outbox processing core (importable for integration tests).
 * Claims pending rows with FOR UPDATE SKIP LOCKED in bounded batches and
 * delivers redacted notifications to the structured delivery sink. The
 * worker NEVER approves, releases or otherwise mutates financial state: a
 * worker outage never releases a held payment request.
 */

export interface OutboxRow {
  id: string;
  tenant_id: string;
  business_event_id: string;
  event_type: string;
  redacted_payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export const BATCH_SIZE = 20;
export const MAX_ATTEMPTS = 5;

export async function processBatch(client: pg.PoolClient): Promise<number> {
  const claimed = await client.query<OutboxRow>(
    `UPDATE outbox_events SET status = 'IN_FLIGHT', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM outbox_events
       WHERE status = 'PENDING' AND next_attempt_at <= now()
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, tenant_id, business_event_id, event_type, redacted_payload, attempts, max_attempts`,
    [BATCH_SIZE],
  );
  let delivered = 0;
  for (const row of claimed.rows) {
    try {
      await deliver(row);
      await client.query(
        `UPDATE outbox_events SET status='DELIVERED', delivered_at=now(), last_error=NULL WHERE id=$1`,
        [row.id],
      );
      delivered += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = row.attempts >= Math.min(row.max_attempts, MAX_ATTEMPTS);
      await client.query(
        `UPDATE outbox_events
           SET status = $2,
               next_attempt_at = now() + ($3 || ' seconds')::interval,
               last_error = $4
         WHERE id = $1`,
        [row.id, giveUp ? 'FAILED' : 'PENDING', String(Math.min(2 ** row.attempts, 300)), message.slice(0, 500)],
      );
      if (giveUp) {
        console.error(`[worker] outbox event ${row.id} permanently failed: ${message}`);
      }
    }
  }
  return delivered;
}

/** Deterministic delivery sink: redacted, structured, no secrets. */
export async function deliver(row: OutboxRow): Promise<void> {
  console.log(
    JSON.stringify({
      channel: 'outbox-delivery',
      tenantId: row.tenant_id,
      eventType: row.event_type,
      businessEventId: row.business_event_id,
      payload: row.redacted_payload,
      at: new Date().toISOString(),
    }),
  );
}

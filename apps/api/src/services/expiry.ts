import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { isActiveHoldState } from '@becbarrier/domain';
import { appendAuditEventWithConfig, AuditEventTypes } from './audit.js';
import { insertOutboxEvent, OutboxEventTypes } from './outbox.js';

/**
 * Deterministic request expiry. Timers NEVER auto-release a hold: expiry is
 * an explicit transition that makes a request ineligible for release. Run
 * periodically by the API process (worker outage never affects this path).
 */

export async function runExpirySweep(db: Db, config: AppConfig): Promise<number> {
  const candidates = await db.query<{
    id: string;
    tenant_id: string;
    revision: number;
    state: string;
    created_at: Date;
    request_expiry_days: number;
  }>(
    `SELECT c.id, c.tenant_id, c.revision, c.state, c.created_at, t.request_expiry_days
     FROM bank_change_requests c JOIN tenants t ON t.id = c.tenant_id
     WHERE c.state IN ('ON_HOLD','CALLBACK_VERIFIED','APPROVAL_1','APPROVAL_2')`,
  );
  let expired = 0;
  const now = Date.now();
  for (const row of candidates.rows) {
    if (!isActiveHoldState(row.state as never)) continue;
    const deadline = row.created_at.getTime() + row.request_expiry_days * 24 * 3600 * 1000;
    if (deadline > now) continue;
    await db.withTransaction(async (client) => {
      const locked = await client.query<{ state: string }>(
        `SELECT state FROM bank_change_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [row.id, row.tenant_id],
      );
      const state = locked.rows[0]?.state;
      if (!state || !['ON_HOLD', 'CALLBACK_VERIFIED', 'APPROVAL_1', 'APPROVAL_2'].includes(state)) return;
      await client.query(
        `UPDATE bank_change_requests SET state = 'EXPIRED', updated_at = now() WHERE id = $1`,
        [row.id],
      );
      await appendAuditEventWithConfig(client, config, {
        tenantId: row.tenant_id,
        aggregateType: 'bank_change_request',
        aggregateId: row.id,
        aggregateVersion: row.revision,
        actorUserId: null,
        eventType: AuditEventTypes.REQUEST_EXPIRED,
        safeMetadata: { revision: row.revision, reason: 'POLICY_EXPIRY', requestAgeDays: row.request_expiry_days },
      });
      await insertOutboxEvent(client, {
        tenantId: row.tenant_id,
        eventType: OutboxEventTypes.REQUEST_TERMINAL,
        redactedPayload: { changeId: row.id, revision: row.revision, terminalState: 'EXPIRED' },
      });
      expired += 1;
    });
  }
  return expired;
}

import type { Db } from '../db.js';
import { err, type ActorState } from '../middleware/error.js';

/**
 * Real persisted statistics for the dashboard and reports. No decorative
 * hardcoded metrics — every number is a tenant-scoped database query.
 */

export interface SummaryStats {
  changes: Record<string, number>;
  callbacksPending: number;
  approvalsPending: number;
  cases: Record<string, number>;
  alerts: { open: number; byPriority: Record<string, number> };
  emailSamples: number;
  auditEvents: number;
  recentChanges: Array<{ id: string; supplierName: string; state: string; revision: number; updatedAt: string }>;
  generatedAt: string;
}

export async function getSummaryStats(db: Db, tenantId: string): Promise<SummaryStats> {
  const changes = await db.query<{ state: string; count: string }>(
    `SELECT state, count(*) AS count FROM bank_change_requests WHERE tenant_id = $1 GROUP BY state`,
    [tenantId],
  );
  const changeMap: Record<string, number> = {};
  for (const row of changes.rows) changeMap[row.state] = Number(row.count);

  const callbacksPending = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM bank_change_requests
     WHERE tenant_id = $1 AND state = 'ON_HOLD'`,
    [tenantId],
  );
  const approvalsPending = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM bank_change_requests
     WHERE tenant_id = $1 AND state IN ('CALLBACK_VERIFIED','APPROVAL_1')`,
    [tenantId],
  );
  const cases = await db.query<{ status: string; count: string }>(
    `SELECT status, count(*) AS count FROM cases WHERE tenant_id = $1 GROUP BY status`,
    [tenantId],
  );
  const caseMap: Record<string, number> = {};
  for (const row of cases.rows) caseMap[row.status] = Number(row.count);

  const alertsOpen = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM alerts WHERE tenant_id = $1 AND disposition = 'OPEN'`,
    [tenantId],
  );
  const alertsByPriority = await db.query<{ priority: string; count: string }>(
    `SELECT priority, count(*) AS count FROM alerts WHERE tenant_id = $1 AND disposition = 'OPEN' GROUP BY priority`,
    [tenantId],
  );
  const byPriority: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const row of alertsByPriority.rows) byPriority[row.priority] = Number(row.count);

  const samples = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM email_samples WHERE tenant_id = $1`,
    [tenantId],
  );
  const auditCount = await db.query<{ count: string }>(
    `SELECT count(*) AS count FROM audit_events WHERE tenant_id = $1`,
    [tenantId],
  );
  const recent = await db.query<{
    id: string;
    supplier_name: string;
    state: string;
    revision: number;
    updated_at: Date;
  }>(
    `SELECT c.id, s.canonical_name AS supplier_name, c.state, c.revision, c.updated_at
     FROM bank_change_requests c JOIN suppliers s ON s.id = c.supplier_id
     WHERE c.tenant_id = $1 ORDER BY c.updated_at DESC LIMIT 8`,
    [tenantId],
  );

  return {
    changes: changeMap,
    callbacksPending: Number(callbacksPending.rows[0]!.count),
    approvalsPending: Number(approvalsPending.rows[0]!.count),
    cases: caseMap,
    alerts: { open: Number(alertsOpen.rows[0]!.count), byPriority },
    emailSamples: Number(samples.rows[0]!.count),
    auditEvents: Number(auditCount.rows[0]!.count),
    recentChanges: recent.rows.map((r) => ({
      id: r.id,
      supplierName: r.supplier_name,
      state: r.state,
      revision: r.revision,
      updatedAt: r.updated_at.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

/** Redacted CSV export (auditor / admin only) — counts only, no PII, no bank data. */
export async function exportSummaryCsv(db: Db, tenantId: string, actor: ActorState): Promise<string> {
  if (actor.role !== 'AUDITOR' && actor.role !== 'TENANT_ADMIN') {
    throw err('FORBIDDEN', 'Export is restricted to auditors and tenant administrators.');
  }
  const stats = await getSummaryStats(db, tenantId);
  const lines = [
    'section,key,value',
    ...Object.entries(stats.changes).map(([k, v]) => `bank_change_state,${k},${v}`),
    `metrics,callbacks_pending,${stats.callbacksPending}`,
    `metrics,approvals_pending,${stats.approvalsPending}`,
    ...Object.entries(stats.cases).map(([k, v]) => `case_status,${k},${v}`),
    `metrics,alerts_open,${stats.alerts.open}`,
    ...Object.entries(stats.alerts.byPriority).map(([k, v]) => `alert_priority,${k},${v}`),
    `metrics,email_samples,${stats.emailSamples}`,
    `metrics,audit_events,${stats.auditEvents}`,
  ];
  return lines.join('\n');
}

export async function listAuditEvents(
  db: Db,
  tenantId: string,
  filters: { eventType?: string; aggregateType?: string; limit: number; cursor?: string },
  actor: ActorState,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  if (actor.role !== 'AUDITOR' && actor.role !== 'TENANT_ADMIN') {
    throw err('FORBIDDEN', 'Audit history is restricted to auditors and tenant administrators.');
  }
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = $1';
  if (filters.eventType) {
    params.push(filters.eventType);
    where += ` AND event_type = $${params.length}`;
  }
  if (filters.aggregateType) {
    params.push(filters.aggregateType);
    where += ` AND aggregate_type = $${params.length}`;
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    where += ` AND id > $${params.length}`;
  }
  params.push(filters.limit);
  const result = await db.query<{
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_version: number;
    actor_name: string | null;
    event_time: Date;
    safe_metadata: Record<string, unknown>;
    sequence: number;
  }>(
    `SELECT a.id, a.event_type, a.aggregate_type, a.aggregate_id, a.aggregate_version,
            u.display_name AS actor_name, a.event_time, a.safe_metadata, a.sequence
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE ${where}
     ORDER BY a.sequence DESC, a.id LIMIT $${params.length}`,
    params,
  );
  const rows = result.rows;
  return {
    items: rows.map((r) => ({
      id: r.id,
      sequence: Number(r.sequence),
      eventType: r.event_type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      aggregateVersion: r.aggregate_version,
      actorName: r.actor_name,
      eventTime: r.event_time.toISOString(),
      metadata: r.safe_metadata,
    })),
    nextCursor: rows.length === filters.limit ? rows[rows.length - 1]!.id : null,
  };
}

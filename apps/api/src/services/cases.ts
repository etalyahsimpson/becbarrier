import { randomUUID } from 'node:crypto';
import type { Db, DbClient } from '../db.js';
import type { AppConfig } from '../config.js';
import { err, type ActorState } from '../middleware/error.js';
import type { CaseEventInput } from '@becbarrier/contracts';
import { appendAuditEventWithConfig, AuditEventTypes } from './audit.js';
import { insertOutboxEvent, OutboxEventTypes } from './outbox.js';

/** Investigation workspace: alerts, cases and tenant-scoped case events. */

export async function listAlerts(
  db: Db,
  tenantId: string,
  filters: { disposition?: string; priority?: string; limit: number; cursor?: string },
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const params: unknown[] = [tenantId];
  let where = 'a.tenant_id = $1';
  if (filters.disposition) {
    params.push(filters.disposition);
    where += ` AND a.disposition = $${params.length}`;
  }
  if (filters.priority) {
    params.push(filters.priority);
    where += ` AND a.priority = $${params.length}`;
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    where += ` AND a.id > $${params.length}`;
  }
  params.push(filters.limit);
  const result = await db.query<{
    id: string;
    priority: string;
    title: string;
    reason_codes: string[];
    disposition: string;
    case_id: string | null;
    email_sample_id: string | null;
    created_at: Date;
  }>(
    `SELECT a.id, a.priority, a.title, a.reason_codes, a.disposition, a.case_id,
            a.email_sample_id, a.created_at
     FROM alerts a WHERE ${where}
     ORDER BY a.created_at DESC, a.id LIMIT $${params.length}`,
    params,
  );
  const rows = result.rows;
  return {
    items: rows.map((a) => ({
      id: a.id,
      priority: a.priority,
      title: a.title,
      reasonCodes: a.reason_codes,
      disposition: a.disposition,
      caseId: a.case_id,
      emailSampleId: a.email_sample_id,
      createdAt: a.created_at.toISOString(),
    })),
    nextCursor: rows.length === filters.limit ? rows[rows.length - 1]!.id : null,
  };
}

export async function getCaseDetail(db: Db, tenantId: string, caseId: string): Promise<unknown> {
  const result = await db.query<{
    id: string;
    title: string;
    status: string;
    priority: string | null;
    assignee_user_id: string | null;
    linked_change_id: string | null;
    linked_email_sample_id: string | null;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, title, status, priority, assignee_user_id, linked_change_id,
            linked_email_sample_id, version, created_at, updated_at
     FROM cases WHERE id = $1 AND tenant_id = $2`,
    [caseId, tenantId],
  );
  const c = result.rows[0];
  if (!c) throw err('NOT_FOUND_IN_TENANT', 'Case not found.');

  const events = await db.query<{
    id: string;
    action: string;
    text: string;
    actor_name: string | null;
    created_at: Date;
  }>(
    `SELECT ce.id, ce.action, ce.text, u.display_name AS actor_name, ce.created_at
     FROM case_events ce LEFT JOIN users u ON u.id = ce.actor_user_id
     WHERE ce.case_id = $1 AND ce.tenant_id = $2 ORDER BY ce.created_at`,
    [caseId, tenantId],
  );
  const linkedAlerts = await db.query<{ id: string; priority: string; title: string; disposition: string }>(
    `SELECT id, priority, title, disposition FROM alerts WHERE case_id = $1 AND tenant_id = $2`,
    [caseId, tenantId],
  );
  const assignee = c.assignee_user_id
    ? await db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [c.assignee_user_id])
    : null;

  return {
    id: c.id,
    title: c.title,
    status: c.status,
    priority: c.priority,
    assigneeName: assignee?.rows[0]?.display_name ?? null,
    linkedChangeId: c.linked_change_id,
    linkedEmailSampleId: c.linked_email_sample_id,
    version: c.version,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
    events: events.rows.map((e) => ({
      id: e.id,
      action: e.action,
      text: e.text,
      actorName: e.actor_name,
      createdAt: e.created_at.toISOString(),
    })),
    alerts: linkedAlerts.rows,
  };
}

export async function listCases(
  db: Db,
  tenantId: string,
  filters: { status?: string; limit: number; cursor?: string },
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = $1';
  if (filters.status) {
    params.push(filters.status);
    where += ` AND status = $${params.length}`;
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    where += ` AND id > $${params.length}`;
  }
  params.push(filters.limit);
  const result = await db.query<{
    id: string;
    title: string;
    status: string;
    priority: string | null;
    version: number;
    updated_at: Date;
  }>(
    `SELECT id, title, status, priority, version, updated_at FROM cases
     WHERE ${where} ORDER BY updated_at DESC, id LIMIT $${params.length}`,
    params,
  );
  const rows = result.rows;
  return {
    items: rows.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      priority: c.priority,
      version: c.version,
      updatedAt: c.updated_at.toISOString(),
    })),
    nextCursor: rows.length === filters.limit ? rows[rows.length - 1]!.id : null,
  };
}

export async function appendCaseEvent(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  caseId: string,
  input: CaseEventInput,
): Promise<{ caseVersion: number }> {
  if (actor.role !== 'SECURITY_ANALYST' && actor.role !== 'TENANT_ADMIN') {
    throw err('FORBIDDEN', 'Only a security analyst (or tenant admin) may work cases.');
  }
  {
    const locked = await client.query<{ id: string; version: number; status: string; title: string }>(
      `SELECT id, version, status, title FROM cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [caseId, actor.tenantId],
    );
    const c = locked.rows[0];
    if (!c) throw err('NOT_FOUND_IN_TENANT', 'Case not found.');
    if (input.expectedVersion !== c.version) {
      throw err('STALE_REVISION', `Case version changed; expected ${input.expectedVersion}, current ${c.version}.`);
    }

    let nextStatus = c.status;
    if (input.action === 'DISPOSITION') {
      const text = input.text.toUpperCase();
      if (['OPEN', 'IN_PROGRESS', 'ESCALATED', 'CLOSED'].includes(text)) {
        nextStatus = text;
      } else {
        throw err('MALFORMED_INPUT', 'Disposition must be one of OPEN, IN_PROGRESS, ESCALATED, CLOSED.');
      }
    }

    await client.query(
      `INSERT INTO case_events (id, tenant_id, case_id, actor_user_id, action, text)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), actor.tenantId, caseId, actor.userId, input.action, input.text],
    );
    if (input.action === 'ASSIGN' && input.assigneeId) {
      const member = await client.query<{ id: string }>(
        `SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.active AND u.status='ACTIVE'`,
        [input.assigneeId, actor.tenantId],
      );
      if (!member.rows[0]) throw err('NOT_FOUND_IN_TENANT', 'Assignee is not an active member of this tenant.');
    }
    const updated = await client.query<{ version: number }>(
      `UPDATE cases
         SET version = version + 1,
             status = $2,
             assignee_user_id = COALESCE($3, assignee_user_id),
             updated_at = now()
       WHERE id = $1 AND version = $4
       RETURNING version`,
      [caseId, nextStatus, input.action === 'ASSIGN' ? input.assigneeId ?? null : null, input.expectedVersion],
    );
    if (!updated.rows[0]) {
      throw err('STALE_REVISION', 'Case was modified concurrently.');
    }

    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'case',
      aggregateId: caseId,
      aggregateVersion: updated.rows[0].version,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.CASE_EVENT_APPENDED,
      safeMetadata: { action: input.action, caseTitle: c.title },
    });
    await insertOutboxEvent(client, {
      tenantId: actor.tenantId,
      eventType: OutboxEventTypes.CASE_EVENT,
      redactedPayload: { caseId, action: input.action, version: updated.rows[0].version },
    });
    return { caseVersion: updated.rows[0].version };
  }
}

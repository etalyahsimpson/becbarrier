/**
 * T10: ordinary application roles cannot UPDATE/DELETE audit events; the
 * verifier detects deliberately tampered event data.
 * T11: an audit-write failure rolls back the financial mutation; worker
 * outage (or worker activity) never releases or advances payment state.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';
import { harness } from '../helpers/harness.js';
import { SEED, seedId, supplierId } from '../../db/seeds/seed-data.js';
import { processBatch } from '../../apps/worker/src/outbox.js';
import { verifyChain, type AuditEventRecord } from '@becbarrier/security';

const PROPOSED = {
  accountIdentifier: 'GB00SYNT000033771199',
  beneficiaryName: 'Vulcan Steel Supplies Ltd',
  bankName: 'Example Trust Bank',
  currency: 'GBP',
};

async function readChain(client: pg.Client, tenantId: string): Promise<AuditEventRecord[]> {
  const events = await client.query<{
    id: string; tenant_id: string; aggregate_type: string; aggregate_id: string;
    aggregate_version: number; actor_user_id: string | null; event_type: string;
    event_time: Date; safe_metadata: Record<string, unknown>; sequence: string;
    prev_event_hash: string; event_hmac: string; key_version: string;
  }>(
    `SELECT id, tenant_id, aggregate_type, aggregate_id, aggregate_version, actor_user_id,
            event_type, event_time, safe_metadata, sequence, prev_event_hash, event_hmac, key_version
     FROM audit_events WHERE tenant_id = $1 ORDER BY sequence ASC`,
    [tenantId],
  );
  return events.rows.map((r) => ({
    id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id,
    aggregateVersion: r.aggregate_version, actorUserId: r.actor_user_id, eventType: r.event_type,
    eventTime: new Date(r.event_time).toISOString(), safeMetadata: r.safe_metadata,
    sequence: Number(r.sequence), prevEventHash: r.prev_event_hash, eventHmac: r.event_hmac,
    keyVersion: r.key_version,
  }));
}

describe('T10: audit immutability and tamper detection', () => {
  it('the application role cannot UPDATE or DELETE audit events', async () => {
    const appDb = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await appDb.connect();
    try {
      await expect(appDb.query(`UPDATE audit_events SET event_type='TAMPER' WHERE sequence = 1`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(appDb.query(`DELETE FROM audit_events WHERE sequence = 1`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(appDb.query(`DELETE FROM bank_change_revisions WHERE revision = 1`)).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await appDb.end();
    }
  });

  it('the integrity verifier detects a tampered event and clears after restore', async () => {
    const client = await harness();
    const tenant = seedId('tenant:atlas');
    const before = verifyChain(process.env.AUDIT_HMAC_KEY!, await readChain(client, tenant));
    expect(before.ok).toBe(true);

    // Deliberate superuser tamper (operator-level access).
    const target = await client.query<{ id: string; safe_metadata: unknown }>(
      `SELECT id, safe_metadata FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 1`,
      [tenant],
    );
    const original = JSON.stringify(target.rows[0]!.safe_metadata);
    await client.query(`UPDATE audit_events SET safe_metadata = '{"tampered": true}' WHERE id = $1`, [
      target.rows[0]!.id,
    ]);
    const tampered = verifyChain(process.env.AUDIT_HMAC_KEY!, await readChain(client, tenant));
    expect(tampered.ok).toBe(false);
    expect(tampered.failures.some((f) => f.reason.includes('HMAC_MISMATCH'))).toBe(true);

    // Restore the original value: the chain verifies again.
    await client.query(`UPDATE audit_events SET safe_metadata = $2 WHERE id = $1`, [
      target.rows[0]!.id,
      original,
    ]);
    const restored = verifyChain(process.env.AUDIT_HMAC_KEY!, await readChain(client, tenant));
    expect(restored.ok).toBe(true);
  });

  it('the audit-verify CLI exits non-zero while tampered and zero after restore', async () => {
    const client = await harness();
    const tenant = seedId('tenant:atlas');
    const target = await client.query<{ id: string; event_hmac: string }>(
      `SELECT id, event_hmac FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 1`,
      [tenant],
    );
    const originalHmac = target.rows[0]!.event_hmac;
    const fakeHmac = 'f'.repeat(64);
    await client.query(`UPDATE audit_events SET event_hmac = $2 WHERE id = $1`, [target.rows[0]!.id, fakeHmac]);
    const runCli = (): string =>
      execFileSync('npx', ['tsx', 'db/verify-audit.ts', '--tenant', 'atlas-mfg'], {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      });
    expect(() => runCli()).toThrow(); // non-zero exit on tamper
    await client.query(`UPDATE audit_events SET event_hmac = $2 WHERE id = $1`, [target.rows[0]!.id, originalHmac]);
    expect(runCli()).toContain('chain=VERIFIED');
  });
});

describe('T11: audit failure rolls back the financial mutation; worker never releases', () => {
  it('a failed audit write aborts the bank-change creation (atomic invariant 7)', async () => {
    const client = await harness();
    // Simulate an audit-system outage for the application role.
    await client.query('REVOKE INSERT ON audit_events FROM bb_api');
    try {
      const session = await loginAs('atlas-initiator');
      const response = await request(getApp())
        .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
        .set(authHeaders(session, `t11-auditfail-${randomUUID()}`))
        .send({ proposed: PROPOSED, reason: 'This must roll back with the audit failure.' });
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('TEMPORARILY_UNAVAILABLE');

      // NO change row survived the rollback.
      const changes = await client.query(
        `SELECT count(*)::int AS n FROM bank_change_requests WHERE reason LIKE 'This must roll back%'`,
      );
      expect(changes.rows[0]!.n).toBe(0);
    } finally {
      await client.query('GRANT INSERT ON audit_events TO bb_api');
    }
  });

  it('worker outage leaves releases committed-but-undelivered; worker runs never mutate financial state', async () => {
    const initiator = await loginAs('atlas-initiator');
    const created = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(authHeaders(initiator, `t11-worker-${randomUUID()}`))
      .send({ proposed: PROPOSED, reason: 'Worker outage test.' });
    expect(created.status).toBe(201);
    const changeId = created.body.id as string;

    // No worker is running: the outbox row stays PENDING and the state is ON_HOLD.
    const client = await harness();
    const pendingBefore = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM outbox_events WHERE redacted_payload->>'changeId' = $1 AND status = 'PENDING'`,
      [changeId],
    );
    expect(Number(pendingBefore.rows[0]!.count)).toBeGreaterThanOrEqual(1);

    // Run the worker until the queue is fully drained (bounded). A single
    // batch claims at most 20 rows, so a growing backlog from other tests
    // must not make this check dependent on global queue depth.
    const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL, max: 2 });
    const workerClient = await pool.connect();
    try {
      let totalDelivered = 0;
      for (let round = 0; round < 200; round += 1) {
        await workerClient.query('BEGIN');
        const delivered = await processBatch(workerClient);
        await workerClient.query('COMMIT');
        totalDelivered += delivered;
        if (delivered === 0) break;
      }
      expect(totalDelivered).toBeGreaterThanOrEqual(1);

      // The financial state is UNCHANGED by worker activity.
      const state = await client.query<{ state: string }>(`SELECT state FROM bank_change_requests WHERE id = $1`, [changeId]);
      expect(state.rows[0]!.state).toBe('ON_HOLD');

      // After a full drain the change's events are all delivered, and a
      // further worker pass delivers nothing new (deterministic dedupe).
      const extra = await processBatch(workerClient);
      const stillPending = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM outbox_events WHERE redacted_payload->>'changeId' = $1 AND status = 'PENDING'`,
        [changeId],
      );
      expect(Number(stillPending.rows[0]!.count)).toBe(0);
      expect(extra).toBe(0);
    } finally {
      workerClient.release();
      await pool.end();
    }

    // A duplicate worker pass cannot create an extra release event.
    const releases = await client.query(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE event_type = 'bank.change.release_instruction' AND redacted_payload->>'changeId' = $1`,
      [changeId],
    );
    expect(releases.rows[0]!.n).toBe(0); // never released — holds require governed evidence
    void SEED;
  });
});

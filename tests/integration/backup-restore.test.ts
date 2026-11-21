/**
 * T14: backup/restore of the test tenant preserves immutable histories and
 * safe replay semantics. Uses pg_dump/pg_restore (PG_DUMP_BIN / PG_RESTORE_BIN
 * env overrides; plain PATH lookup otherwise — CI installs postgresql-client).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';
import { harness } from '../helpers/harness.js';
import { SEED, seedId, supplierId } from '../../db/seeds/seed-data.js';
import { verifyChain, type AuditEventRecord } from '@becbarrier/security';

const RESTORE_DB = 'becbarrier_restore_test';
const DUMP_FILE = '/tmp/becbarrier-t14-backup.dump';

function parseUrl(url: string): { host: string; port: string; user: string; password: string } {
  const queryMatch = /[?&]host=([^&]+)/.exec(url);
  const match = /postgresql:\/\/([^@\/]*)@([^:\/?]*)(?::(\d+))?/.exec(url);
  const [user, password] = (match?.[1] ?? '').split(':');
  const host = queryMatch?.[1] ?? (match?.[2] || 'localhost');
  return { host, port: match?.[3] || '5432', user: user || 'postgres', password: password || '' };
}

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

describe('T14: backup and restore preserves immutable history and replay safety', () => {
  it('dumps, restores and verifies histories on a fresh database', async () => {
    const sourceUrl = process.env.MIGRATION_DATABASE_URL!;
    const { host, port, user, password } = parseUrl(sourceUrl);
    const admin = await harness();

    // Create a deterministic released change first so the backup contains a
    // full governed history (created → verified → approved ×2 → released).
    const initiator = await loginAs('atlas-initiator');
    const verifier = await loginAs('atlas-verifier');
    const a1 = await loginAs('atlas-approver1');
    const a2 = await loginAs('atlas-approver2');
    const changeKey = `t14-create-${randomUUID()}`;
    const create = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(authHeaders(initiator, changeKey))
      .send({
        proposed: {
          accountIdentifier: 'GB00SYNT000044882211',
          beneficiaryName: 'Vulcan Steel Supplies Ltd',
          bankName: 'Example Trust Bank',
          currency: 'GBP',
        },
        reason: 'T14 backup/restore fixture change.',
      });
    expect(create.status).toBe(201);
    const changeId = create.body.id as string;
    const steps: Array<[string, string, unknown]> = [
      ['verify', `t14-verify-${randomUUID()}`, {
        revision: 1, approvedContactId: seedId(SEED.contacts['vulcan-phone']!.key),
        result: 'CONFIRMED', method: 'APPROVED_DIRECTORY_CONTACT', evidenceRef: 't14-call',
      }],
      ['decisions', `t14-d1-${randomUUID()}`, { revision: 1, decision: 'APPROVE' }],
      ['decisions', `t14-d2-${randomUUID()}`, { revision: 1, decision: 'APPROVE' }],
      ['release', `t14-rel-${randomUUID()}`, { revision: 1 }],
    ];
    const actors = [verifier, a1, a2, a1];
    for (const [index, [path, key, body]] of steps.entries()) {
      const response = await request(getApp())
        .post(`/api/v1/bank-changes/${changeId}/${path}`)
        .set(authHeaders(actors[index]!, key))
        .send(body as object);
      if (response.status !== 200) { throw new Error(`step ${path} -> ${response.status} ${JSON.stringify(response.body).slice(0, 300)}`); }
    }

    // Snapshot counts on the source database.
    const countsBefore = await admin.query<{
      changes: string; revisions: string; callbacks: string; decisions: string; audit: string; idempotency: string; released: string;
    }>(
      `SELECT
         (SELECT count(*) FROM bank_change_requests) AS changes,
         (SELECT count(*) FROM bank_change_revisions) AS revisions,
         (SELECT count(*) FROM callback_verifications) AS callbacks,
         (SELECT count(*) FROM approval_decisions) AS decisions,
         (SELECT count(*) FROM audit_events) AS audit,
         (SELECT count(*) FROM idempotency_records) AS idempotency,
         (SELECT count(*) FROM bank_change_requests WHERE state = 'RELEASED_FOR_ERP_UPDATE') AS released`,
    );
    const before = countsBefore.rows[0]!;

    // Dump (custom format).
    if (existsSync(DUMP_FILE)) rmSync(DUMP_FILE);
    const pgDump = process.env.PG_DUMP_BIN ?? 'pg_dump';
    const pgRestore = process.env.PG_RESTORE_BIN ?? 'pg_restore';
    const connArgs = ['-h', host, '-p', port, '-U', user];
    execFileSync(pgDump, [...connArgs, '-Fc', '-f', DUMP_FILE, 'becbarrier_test'], {
      env: { ...process.env, PGPASSWORD: password || process.env.PGPASSWORD || '' },
    });

    // Fresh restore database.
    await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
    await admin.query(`CREATE DATABASE ${RESTORE_DB}`);
    execFileSync(pgRestore, [...connArgs, '-d', RESTORE_DB, '--no-owner', DUMP_FILE], {
      env: { ...process.env, PGPASSWORD: password || process.env.PGPASSWORD || '' },
    });

    // Restore target connection (same socket host).
    const restoreUrl = sourceUrl.replace('becbarrier_test', RESTORE_DB);
    const restored = new pg.Client({ connectionString: restoreUrl });
    await restored.connect();
    try {
      const countsAfter = await restored.query<{
        changes: string; revisions: string; callbacks: string; decisions: string; audit: string; idempotency: string; released: string;
      }>(
        `SELECT
           (SELECT count(*) FROM bank_change_requests) AS changes,
           (SELECT count(*) FROM bank_change_revisions) AS revisions,
           (SELECT count(*) FROM callback_verifications) AS callbacks,
           (SELECT count(*) FROM approval_decisions) AS decisions,
           (SELECT count(*) FROM audit_events) AS audit,
           (SELECT count(*) FROM idempotency_records) AS idempotency,
           (SELECT count(*) FROM bank_change_requests WHERE state = 'RELEASED_FOR_ERP_UPDATE') AS released`,
      );
      const after = countsAfter.rows[0]!;
      expect(Number(after.changes)).toBe(Number(before.changes));
      expect(Number(after.revisions)).toBe(Number(before.revisions));
      expect(Number(after.callbacks)).toBe(Number(before.callbacks));
      expect(Number(after.decisions)).toBe(Number(before.decisions));
      expect(Number(after.audit)).toBe(Number(before.audit));
      expect(Number(after.idempotency)).toBe(Number(before.idempotency));
      expect(Number(after.released)).toBe(Number(before.released));

      // The audit chain verifies on the restored database.
      const atlas = seedId('tenant:atlas');
      const chain = verifyChain(process.env.AUDIT_HMAC_KEY!, await readChain(restored, atlas));
      expect(chain.ok).toBe(true);

      // Immutable revision history survived for the fixture change.
      const revisions = await restored.query<{ revision: number }>(
        `SELECT revision FROM bank_change_revisions WHERE change_id = $1 ORDER BY revision`,
        [changeId],
      );
      expect(revisions.rows.map((r) => Number(r.revision))).toEqual([1]);
    } finally {
      await restored.end();
    }

    // Safe replay semantics: the committed idempotency record still maps the
    // original key to the SAME change — a replay cannot authorize a second release.
    const replay = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(authHeaders(initiator, changeKey))
      .send({
        proposed: {
          accountIdentifier: 'GB00SYNT000044882211',
          beneficiaryName: 'Vulcan Steel Supplies Ltd',
          bankName: 'Example Trust Bank',
          currency: 'GBP',
        },
        reason: 'T14 backup/restore fixture change.',
      });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(changeId);
    const releasedNow = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM bank_change_requests WHERE state = 'RELEASED_FOR_ERP_UPDATE'`,
    );
    expect(Number(releasedNow.rows[0]!.count)).toBe(Number(before.released));

    await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
  });
});

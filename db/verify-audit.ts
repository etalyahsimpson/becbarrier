#!/usr/bin/env tsx
/**
 * Audit integrity verification CLI (handoff 7.7 / master spec 8.5).
 *
 * Recomputes the HMAC chain for every tenant using AUDIT_DATABASE_URL
 * (read-only role) and AUDIT_HMAC_KEY. Exits non-zero when the chain does
 * not verify. Optional --tenant <slug> restricts the check.
 *
 * Usage: tsx db/verify-audit.ts [--tenant atlas-mfg] [--json]
 */
import pg from 'pg';
import { verifyChain, type AuditEventRecord } from '@becbarrier/security';

function parseArgs(): { tenant?: string; json: boolean } {
  const args = process.argv.slice(2);
  const tenantIdx = args.indexOf('--tenant');
  return {
    tenant: tenantIdx >= 0 ? args[tenantIdx + 1] : undefined,
    json: args.includes('--json'),
  };
}

async function main(): Promise<void> {
  const { tenant, json } = parseArgs();
  const url = process.env.AUDIT_DATABASE_URL ?? process.env.DATABASE_URL;
  const key = process.env.AUDIT_HMAC_KEY;
  if (!url || !key) {
    console.error('AUDIT_DATABASE_URL (or DATABASE_URL) and AUDIT_HMAC_KEY are required.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tenants = await client.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM tenants ${tenant ? 'WHERE slug = $1' : ''} ORDER BY slug`,
      tenant ? [tenant] : [],
    );
    if (tenants.rows.length === 0) {
      console.error(`no tenants found${tenant ? ` matching '${tenant}'` : ''}`);
      process.exit(1);
    }
    const results = [];
    let allOk = true;
    for (const t of tenants.rows) {
      const events = await client.query<{
        id: string;
        tenant_id: string;
        aggregate_type: string;
        aggregate_id: string;
        aggregate_version: number;
        actor_user_id: string | null;
        event_type: string;
        event_time: Date;
        safe_metadata: Record<string, unknown>;
        sequence: number;
        prev_event_hash: string;
        event_hmac: string;
        key_version: string;
      }>(
        `SELECT id, tenant_id, aggregate_type, aggregate_id, aggregate_version,
                actor_user_id, event_type, event_time, safe_metadata, sequence,
                prev_event_hash, event_hmac, key_version
         FROM audit_events WHERE tenant_id = $1 ORDER BY sequence ASC`,
        [t.id],
      );
      const records: AuditEventRecord[] = events.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        aggregateVersion: r.aggregate_version,
        actorUserId: r.actor_user_id,
        eventType: r.event_type,
        eventTime: new Date(r.event_time).toISOString(),
        safeMetadata: r.safe_metadata,
        sequence: Number(r.sequence),
        prevEventHash: r.prev_event_hash,
        eventHmac: r.event_hmac,
        keyVersion: r.key_version,
      }));
      const verification = verifyChain(key, records);
      allOk = allOk && verification.ok;
      results.push({ tenant: t.slug, ...verification, failures: verification.failures.slice(0, 20) });
    }
    if (json) {
      console.log(JSON.stringify({ ok: allOk, tenants: results }, null, 2));
    } else {
      for (const r of results) {
        const status = r.ok ? 'VERIFIED' : 'TAMPER DETECTED';
        console.log(`tenant=${r.tenant} events=${r.checkedCount} chain=${status}`);
        for (const f of r.failures) {
          console.log(`  ! sequence=${f.sequence} eventId=${f.eventId ?? '-'} reason=${f.reason}`);
        }
      }
    }
    process.exit(allOk ? 0 : 1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('audit verification failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Creates the least-privilege PostgreSQL roles and grants (handoff 6.4):
 *   - bb_api      : business tables DML, but INSERT/SELECT ONLY on audit_events
 *                   and bank_change_revisions (append-only financial history).
 *   - bb_worker   : outbox processing only.
 *   - bb_audit_ro : read-only audit/verification access.
 *
 * Must run AFTER `db:migrate` and uses the DDL-capable MIGRATION_DATABASE_URL.
 * Passwords come from DB_API_PASSWORD / DB_WORKER_PASSWORD / DB_AUDIT_PASSWORD
 * (development/CI throwaway values; production uses a real secret store).
 */
import pg from 'pg';

const ROLES = [
  { role: 'bb_api', passwordEnv: 'DB_API_PASSWORD' },
  { role: 'bb_worker', passwordEnv: 'DB_WORKER_PASSWORD' },
  { role: 'bb_audit_ro', passwordEnv: 'DB_AUDIT_PASSWORD' },
] as const;

const BUSINESS_TABLES = [
  'tenants',
  'users',
  'memberships',
  'audit_sequences',
  'suppliers',
  'supplier_contacts',
  'supplier_payment_accounts',
  'bank_change_requests',
  'callback_verifications',
  'approval_decisions',
  'email_samples',
  'email_findings',
  'alerts',
  'cases',
  'case_events',
  'idempotency_records',
];

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is required.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const dbResult = await client.query<{ dbname: string }>('SELECT current_database() AS dbname');
    const dbname = dbResult.rows[0]!.dbname;
    for (const { role, passwordEnv } of ROLES) {
      const password = process.env[passwordEnv];
      if (!password || password.length < 12) {
        throw new Error(`${passwordEnv} must be set to a value of at least 12 characters.`);
      }
      await client.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
             CREATE ROLE ${role} LOGIN;
           END IF;
         END $$;`,
      );
      // Utility statements cannot bind parameters: escape the password literal.
      const escaped = password.replace(/'/g, "''");
      await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${escaped}'`);
      await client.query(`GRANT CONNECT ON DATABASE "${dbname}" TO ${role}`);
    }

    // bb_api: read/write on business tables.
    for (const table of BUSINESS_TABLES) {
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO bb_api`);
    }
    // Append-only financial history: no UPDATE/DELETE for the application role.
    await client.query('GRANT SELECT, INSERT ON TABLE bank_change_revisions TO bb_api');
    await client.query('GRANT SELECT, INSERT ON TABLE audit_events TO bb_api');
    await client.query('GRANT SELECT, INSERT, UPDATE ON TABLE outbox_events TO bb_api');
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bb_api');

    // bb_worker: outbox lifecycle only (plus enough read context to log safely).
    await client.query('GRANT SELECT, UPDATE ON TABLE outbox_events TO bb_worker');
    await client.query('GRANT SELECT ON TABLE tenants, users, bank_change_requests TO bb_worker');

    // bb_audit_ro: read-only audit and reference data.
    await client.query(
      'GRANT SELECT ON TABLE audit_events, bank_change_requests, bank_change_revisions, callback_verifications, approval_decisions, cases, case_events, alerts, email_samples, email_findings, tenants, users, memberships TO bb_audit_ro',
    );

    // Revoke public schema create; keep default deny posture.
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');

    console.log('least-privilege roles provisioned: bb_api, bb_worker, bb_audit_ro');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('role setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

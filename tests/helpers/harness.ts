/**
 * Superuser test harness for database-level assertions and controlled time
 * manipulation (e.g., expiring a callback). Uses MIGRATION_DATABASE_URL —
 * the SAME privileges an operator/DBA would have, deliberately distinct from
 * the application role the API uses.
 */
import pg from 'pg';

let cachedClient: pg.Client | null = null;

export async function harness(): Promise<pg.Client> {
  if (!cachedClient) {
    const url = process.env.MIGRATION_DATABASE_URL;
    if (!url) throw new Error('MIGRATION_DATABASE_URL required for the test harness.');
    cachedClient = new pg.Client({ connectionString: url });
    await cachedClient.connect();
  }
  return cachedClient;
}

export async function closeHarness(): Promise<void> {
  if (cachedClient) {
    await cachedClient.end().catch(() => undefined);
    cachedClient = null;
  }
}

/** Expire the confirmed callback of a change (simulated time passage, T18). */
export async function expireCallback(changeId: string): Promise<void> {
  const client = await harness();
  await client.query(
    `UPDATE callback_verifications SET expires_at = now() - interval '1 hour'
     WHERE change_id = $1 AND result = 'CONFIRMED'`,
    [changeId],
  );
  await client.query(
    `UPDATE bank_change_requests SET callback_expires_at = now() - interval '1 hour' WHERE id = $1`,
    [changeId],
  );
}

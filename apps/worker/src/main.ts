import pg from 'pg';
import { BATCH_SIZE, processBatch } from './outbox.js';

/**
 * Outbox worker entrypoint. Polls in bounded batches with backoff; financial
 * authority never depends on this process.
 */

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);

async function main(): Promise<void> {
  const url = process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('WORKER_DATABASE_URL (or DATABASE_URL) is required.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  console.log('[worker] BECBarrier outbox worker started');

  let running = true;
  process.on('SIGTERM', () => {
    running = false;
  });
  process.on('SIGINT', () => {
    running = false;
  });

  while (running) {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const delivered = await processBatch(client);
        await client.query('COMMIT');
        if (delivered > 0) console.log(`[worker] delivered ${delivered} notification(s)`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('[worker] batch failed:', err instanceof Error ? err.message : err);
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[worker] connection error:', err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  await pool.end().catch(() => undefined);
  process.exit(0);
}

main().catch((err) => {
  console.error('worker fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});

export { BATCH_SIZE };

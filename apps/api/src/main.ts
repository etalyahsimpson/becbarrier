import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { Db } from './db.js';
import { createApp } from './app.js';
import { attachRealtime } from './services/realtime.js';
import { runExpirySweep } from './services/expiry.js';

/**
 * API entrypoint. Boots the Express authoritative API with WebSocket
 * realtime attached to the same HTTP server, and runs the deterministic
 * request-expiry sweep on an interval (never auto-releasing a hold).
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Db(config.databaseUrl);
  const app = createApp({ db, config });

  // Fail fast if the database is unreachable at boot.
  try {
    await db.query('SELECT 1');
  } catch (e) {
    console.error('FATAL: database unreachable at boot:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const server = createServer(app);
  attachRealtime(server, config);

  const sweepIntervalMs = Number(process.env.EXPIRY_SWEEP_INTERVAL_MS ?? 60_000);
  const sweepTimer = setInterval(() => {
    runExpirySweep(db, config).catch((err) => {
      console.error('[expiry-sweep] failed:', err instanceof Error ? err.message : err);
    });
  }, sweepIntervalMs);
  sweepTimer.unref();

  server.listen(config.port, () => {
    console.log(`[api] BECBarrier authoritative API listening on :${config.port} (${config.appEnv})`);
  });

  const shutdown = async (): Promise<void> => {
    clearInterval(sweepTimer);
    server.close();
    await db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('FATAL boot error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

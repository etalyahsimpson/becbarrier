#!/usr/bin/env tsx
/**
 * Versioned, reversible PostgreSQL migration runner.
 * Reads db/migrations/*.sql files containing `-- +migrate Up` and
 * `-- +migrate Down` sections and records applied versions in
 * schema_migrations. Runs with the MIGRATION_DATABASE_URL (DDL-capable role).
 *
 * Usage: tsx db/migrate.ts up | down <version> | status
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

async function connect(): Promise<pg.Client> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is required (DDL-capable connection for migrations).');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

interface MigrationFile {
  version: number;
  name: string;
  up: string;
  down: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const m = /^(\d+)_(.+)\.sql$/.exec(file);
    if (!m) throw new Error(`bad migration filename: ${file}`);
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const upMatch = /-- \+migrate Up\r?\n([\s\S]*?)(?=-- \+migrate Down|$)/.exec(content);
    const downMatch = /-- \+migrate Down\r?\n([\s\S]*)$/.exec(content);
    if (!upMatch) throw new Error(`missing '-- +migrate Up' section in ${file}`);
    out.push({
      version: Number(m[1]),
      name: m[2]!,
      up: upMatch[1]!,
      down: downMatch?.[1]?.trim() ?? '',
    });
  }
  return out;
}

async function ensureTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applied(client: pg.Client): Promise<Set<number>> {
  const res = await client.query<Record<string, number>>('SELECT version FROM schema_migrations');
  return new Set(res.rows.map((r) => Number(r.version)));
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2) as [string | undefined, string | undefined];
  const client = await connect();
  try {
    await ensureTable(client);
    const migrations = await loadMigrations();
    const done = await applied(client);

    if (cmd === 'status') {
      for (const m of migrations) {
        console.log(`${done.has(m.version) ? '[applied]' : '[pending]'} ${m.version}_${m.name}`);
      }
      return;
    }

    if (cmd === 'up') {
      for (const m of migrations) {
        if (done.has(m.version)) continue;
        console.log(`applying ${m.version}_${m.name}`);
        await client.query('BEGIN');
        try {
          await client.query(m.up);
          await client.query('INSERT INTO schema_migrations(version, name) VALUES ($1, $2)', [
            m.version,
            m.name,
          ]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
      console.log(`migrations up to date (${done.size + migrations.filter((m) => !done.has(m.version)).length} applied)`);
      return;
    }

    if (cmd === 'down') {
      const target = arg ? Number(arg) : Math.max(...migrations.map((m) => m.version), 0);
      const m = migrations.find((x) => x.version === target);
      if (!m) throw new Error(`no migration with version ${target}`);
      if (!done.has(target)) throw new Error(`migration ${target} is not applied`);
      if (!m.down) throw new Error(`migration ${target} has no Down section`);
      console.log(`reverting ${m.version}_${m.name}`);
      await client.query('BEGIN');
      try {
        await client.query(m.down);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [target]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      return;
    }

    console.error('usage: tsx db/migrate.ts up | down <version> | status');
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

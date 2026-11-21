import pg from 'pg';

/**
 * Thin parameterized-SQL access layer over node-postgres. No ORM: every
 * query is explicit SQL with bound parameters, tenant-scoped by the callers.
 */

export type DbClient = pg.PoolClient;

export class Db {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string, maxConnections = 10) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: maxConnections,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(sql, params as never[]) as Promise<pg.QueryResult<T>>;
  }

  async withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection already broken
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

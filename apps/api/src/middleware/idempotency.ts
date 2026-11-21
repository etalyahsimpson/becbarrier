import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { Db, DbClient } from '../db.js';
import { err } from './error.js';
import { sha256Hex } from '@becbarrier/security';

/**
 * Idempotency runner for safely repeatable POST mutations.
 *
 * The idempotency record is inserted INSIDE the same transaction as the
 * business mutation: replay of the same key + identical body returns the
 * original committed outcome; the same key with a different body returns
 * 409 IDEMPOTENCY_CONFLICT with no mutation; a key still in flight from a
 * concurrent request resolves deterministically after the first transaction
 * commits (the unique index serializes the insert).
 */

export interface MutationOutcome {
  status: number;
  body: unknown;
}

export interface IdempotentResult extends MutationOutcome {
  replayed: boolean;
}

export async function runIdempotentMutation(
  db: Db,
  req: Request,
  endpoint: string,
  fn: (client: DbClient) => Promise<MutationOutcome>,
): Promise<IdempotentResult> {
  const actor = req.bb?.actor;
  if (!actor) throw err('UNAUTHENTICATED', 'Authentication required.');
  const key = req.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128) {
    throw err('MALFORMED_INPUT', 'An Idempotency-Key header (8–128 chars) is required for this mutation.');
  }
  const digest = sha256Hex(JSON.stringify(req.body ?? {}));

  return db.withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO idempotency_records
         (id, tenant_id, actor_user_id, endpoint, idempotency_key, request_digest, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
       ON CONFLICT (tenant_id, actor_user_id, endpoint, idempotency_key) DO NOTHING
       RETURNING id`,
      [randomUUID(), actor.tenantId, actor.userId, endpoint, key, digest],
    );

    if (inserted.rows.length === 0) {
      const existing = await client.query<{
        request_digest: string;
        response_status: number | null;
        response_body: unknown;
      }>(
        `SELECT request_digest, response_status, response_body
         FROM idempotency_records
         WHERE tenant_id=$1 AND actor_user_id=$2 AND endpoint=$3 AND idempotency_key=$4`,
        [actor.tenantId, actor.userId, endpoint, key],
      );
      const row = existing.rows[0];
      if (!row) throw err('TEMPORARILY_UNAVAILABLE', 'Idempotency record unavailable.');
      if (row.request_digest !== digest) {
        throw err(
          'IDEMPOTENCY_CONFLICT',
          'This Idempotency-Key was already used with a different request body; no mutation was applied.',
        );
      }
      if (row.response_status === null) {
        throw err(
          'IDEMPOTENCY_IN_PROGRESS',
          'A request with this Idempotency-Key is still completing; retry shortly.',
        );
      }
      return { status: row.response_status, body: row.response_body, replayed: true };
    }

    const recordId = inserted.rows[0]!.id;
    const outcome = await fn(client);
    const bodyJson = JSON.stringify(outcome.body ?? {});
    if (bodyJson.length <= 64 * 1024) {
      await client.query(
        `UPDATE idempotency_records SET response_status=$1, response_body=$2 WHERE id=$3`,
        [outcome.status, bodyJson, recordId],
      );
    } else {
      await client.query(
        `UPDATE idempotency_records SET response_status=$1, response_body='{"truncated":true}' WHERE id=$2`,
        [outcome.status, recordId],
      );
    }
    return { ...outcome, replayed: false };
  });
}

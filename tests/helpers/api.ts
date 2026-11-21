/**
 * Supertest client for the Express app plus actor login helpers backed by
 * the strictly development/test demo identity adapter.
 */
import request, { type Agent } from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../../apps/api/src/config.js';
import { Db } from '../../apps/api/src/db.js';
import { createApp } from '../../apps/api/src/app.js';
import { userId, tenantId } from '../../db/seeds/seed-data.js';

let cachedApp: Express | null = null;
let cachedDb: Db | null = null;

export function getApp(): Express {
  if (!cachedApp) {
    const config = loadConfig();
    cachedDb = new Db(config.databaseUrl, 5);
    cachedApp = createApp({ db: cachedDb, config });
  }
  return cachedApp;
}

export function getDb(): Db {
  if (!cachedDb) getApp();
  return cachedDb!;
}

export interface Session {
  agent: Agent;
  csrfToken: string;
  cookie: string;
  actor: { userId: string; tenantId: string; role: string; userName: string; tenantSlug: string };
}

/** Sign in as one of the seeded synthetic actors (test identity adapter). */
export async function loginAs(actorKey: string): Promise<Session> {
  const tenant: 'atlas' | 'cascade' = actorKey.startsWith('cascade') ? 'cascade' : 'atlas';
  const agent = request.agent(getApp());
  const response = await agent
    .post('/api/v1/auth/demo-login')
    .send({ userId: userId(actorKey), tenantId: tenantId(tenant) });
  if (response.status !== 200) {
    throw new Error(`demo-login failed for ${actorKey}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const setCookies = (response.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  return {
    agent,
    cookie,
    csrfToken: response.body.csrfToken as string,
    actor: response.body.actor,
  };
}

/** Standard headers for authenticated state-changing requests. */
export function authHeaders(session: Session, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: session.cookie,
    'x-csrf-token': session.csrfToken,
  };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return headers;
}

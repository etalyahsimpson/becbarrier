/**
 * T13: expired session, missing CSRF, disabled membership and privilege
 * downgrade are all denied server-side. Plus API security essentials:
 * structured errors, security headers, rate limiting, and the full role
 * permission matrix (handoff section 4.3).
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';
import { harness } from '../helpers/harness.js';
import { supplierId, userId } from '../../db/seeds/seed-data.js';
import { newSessionPayload, signSession } from '@becbarrier/security';

const PROPOSED = {
  accountIdentifier: 'GB00SYNT000066554433',
  beneficiaryName: 'Vulcan Steel Supplies Ltd',
  bankName: 'Example Trust Bank',
  currency: 'GBP',
};

describe('T13: session, CSRF and membership denials', () => {
  it('rejects requests without a session cookie', async () => {
    const response = await request(getApp()).get('/api/v1/suppliers');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered session cookie', async () => {
    const session = await loginAs('atlas-initiator');
    const cookies = (session.agent as unknown as { jar?: unknown }).jar;
    void cookies;
    const response = await request(getApp())
      .get('/api/v1/suppliers')
      .set('cookie', 'bb_session=tampered.token.value');
    expect(response.status).toBe(401);
  });

  it('rejects an expired session (server-side expiry, not browser clock)', async () => {
    const config = (await import('../../apps/api/src/config.js')).loadConfig();
    const expired = { ...newSessionPayload(userId('atlas-initiator'), 'any-tenant', 60), exp: 1 };
    const { sessionToken } = signSession(config.sessionSigningKey, expired);
    const response = await request(getApp())
      .get('/api/v1/suppliers')
      .set('cookie', `bb_session=${sessionToken}`);
    expect(response.status).toBe(401);
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const session = await loginAs('atlas-initiator');
    const response = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set('cookie', `bb_session=valid-session-needed`) // replaced below with real cookie
      .send({ proposed: PROPOSED, reason: 'CSRF missing.' });
    expect(response.status).toBe(401);
    // With a REAL session but no CSRF header:
    const withSession = await session.agent
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .send({ proposed: PROPOSED, reason: 'CSRF missing.' });
    expect(withSession.status).toBe(403);
    expect(withSession.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a mismatching CSRF token', async () => {
    const session = await loginAs('atlas-initiator');
    const response = await session.agent
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set('x-csrf-token', 'a'.repeat(64))
      .set('idempotency-key', `csrf-${randomUUID()}`)
      .send({ proposed: PROPOSED, reason: 'CSRF mismatch.' });
    expect(response.status).toBe(403);
  });

  it('denies a disabled membership immediately (server-side on every action)', async () => {
    const client = await harness();
    const session = await loginAs('atlas-approver2'); // login while still active
    await client.query(`UPDATE memberships SET active = FALSE WHERE user_id = $1`, [userId('atlas-approver2')]);
    try {
      const response = await session.agent.get('/api/v1/suppliers');
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    } finally {
      await client.query(`UPDATE memberships SET active = TRUE WHERE user_id = $1`, [userId('atlas-approver2')]);
    }
  });

  it('a privilege downgrade takes effect on the next request', async () => {
    const client = await harness();
    // Downgrade a member that just held the initiator role.
    const session = await loginAs('atlas-initiator');
    const before = await session.agent.get('/api/v1/auth/me');
    expect(before.body.role).toBe('FINANCE_INITIATOR');
    await client.query(
      `UPDATE memberships SET role = 'AUDITOR', active = TRUE WHERE user_id = $1`,
      [userId('atlas-initiator')],
    );
    try {
      const denied = await session.agent
        .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
        .set(authHeaders(session, `t13-downgrade-${randomUUID()}`))
        .send({ proposed: PROPOSED, reason: 'Downgraded member must not initiate.' });
      expect(denied.status).toBe(403);
      const me = await session.agent.get('/api/v1/auth/me');
      expect(me.body.role).toBe('AUDITOR');
    } finally {
      await client.query(
        `UPDATE memberships SET role = 'FINANCE_INITIATOR' WHERE user_id = $1`,
        [userId('atlas-initiator')],
      );
    }
  });
});

describe('security essentials', () => {
  it('sends strict security headers on API responses', async () => {
    const response = await request(getApp()).get('/api/v1/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a correlation id on every response and in errors', async () => {
    const ok = await request(getApp()).get('/api/v1/health');
    expect(ok.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
    const denied = await request(getApp()).get('/api/v1/suppliers');
    expect(denied.body.correlationId).toMatch(/[0-9a-f-]{36}/);
  });

  it('unknown routes return a neutral 404 envelope (authenticated) and 401 otherwise', async () => {
    const session = await loginAs('atlas-analyst');
    const response = await session.agent.get('/api/v1/definitely-not-a-route');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND_IN_TENANT');
    const anonymous = await request(getApp()).get('/api/v1/definitely-not-a-route');
    expect(anonymous.status).toBe(401);
  });

  it('bounds pagination limits', async () => {
    const session = await loginAs('atlas-analyst');
    const response = await session.agent.get('/api/v1/alerts?limit=10000');
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeLessThanOrEqual(100);
  });

});

describe('role permission matrix (handoff 4.3)', () => {
  const ROLES = [
    'atlas-initiator',
    'atlas-verifier',
    'atlas-approver1',
    'atlas-analyst',
    'atlas-auditor',
    'atlas-admin',
  ] as const;

  it('only FINANCE_INITIATOR (and admin) may create bank changes', async () => {
    const allowed = new Set(['atlas-initiator', 'atlas-admin']);
    for (const actor of ROLES) {
      const session = await loginAs(actor);
      const response = await session.agent
        .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
        .set(authHeaders(session, `role-matrix-create-${actor}-${randomUUID()}`))
        .send({ proposed: PROPOSED, reason: `Role matrix: ${actor}` });
      if (allowed.has(actor)) {
        expect(response.status).toBe(201);
      } else {
        expect(response.status).toBe(403);
      }
    }
  });

  it('auditors are read-only across the API', async () => {
    const session = await loginAs('atlas-auditor');
    const read = await session.agent.get('/api/v1/audit-events?limit=5');
    expect(read.status).toBe(200);
    const upload = await session.agent
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(Buffer.from('From: a@b.example\nSubject: x\n\nbody'));
    expect(upload.status).toBe(403);
    const alert = await session.agent.get('/api/v1/alerts');
    expect(alert.status).toBe(403); // auditors use audit endpoints, not analyst alert feeds
  });

  it('analysts cannot approve or release anything', async () => {
    const session = await loginAs('atlas-analyst');
    const changeId = (await import('../../db/seeds/seed-data.js')).changeId('BC-SEED-1');
    const decision = await session.agent
      .post(`/api/v1/bank-changes/${changeId}/decisions`)
      .set(authHeaders(session, `analyst-decide-${randomUUID()}`))
      .send({ revision: 1, decision: 'APPROVE' });
    expect(decision.status).toBe(403);
    const release = await session.agent
      .post(`/api/v1/bank-changes/${changeId}/release`)
      .set(authHeaders(session, `analyst-release-${randomUUID()}`))
      .send({ revision: 1 });
    expect(release.status).toBe(403);
  });
});

// Runs LAST: intentionally exhausts one actor's per-minute bucket.
describe('rate limiting (final, budget-exhausting)', () => {
  it('applies rate limiting with 429 and Retry-After', async () => {
    const session = await loginAs('cross-auditor');
    let saw429 = false;
    for (let i = 0; i < 320 && !saw429; i += 1) {
      const response = await session.agent.get('/api/v1/realtime/summary');
      if (response.status === 429) {
        saw429 = true;
        expect(response.body.error.code).toBe('RATE_LIMITED');
        expect(response.headers['retry-after']).toBeDefined();
      }
    }
    expect(saw429).toBe(true);
  }, 60_000);
});

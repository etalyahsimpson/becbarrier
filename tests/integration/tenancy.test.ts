/**
 * T09: tenant A cannot read or mutate tenant B records using known UUIDs.
 * T15: forged actor/tenant claims are ignored; exports are strictly tenant-scoped.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';
import { changeId, seedId, supplierId } from '../../db/seeds/seed-data.js';

describe('T09: cross-tenant access by known UUID is neutralized', () => {
  it('returns neutral 404s for cascade-owned resources when authenticated as atlas', async () => {
    const session = await loginAs('atlas-analyst');
    const headers = authHeaders(session);

    const responses = await Promise.all([
      request(getApp()).get(`/api/v1/bank-changes/${changeId('BC-SEED-7')}`).set(headers),
      request(getApp()).get(`/api/v1/suppliers/${supplierId('beacon-media')}`).set(headers),
      request(getApp()).get(`/api/v1/bank-changes/${changeId('BC-SEED-8')}`).set(headers),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND_IN_TENANT');
    }

    // Mutations are equally neutralized.
    const mutated = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId('BC-SEED-7')}/cancel`)
      .set(authHeaders(session, `t09-cancel-${randomUUID()}`))
      .send({});
    expect(mutated.status).toBe(404);
  });

  it('lists and counters never include cross-tenant data', async () => {
    const session = await loginAs('atlas-analyst');
    const headers = authHeaders(session);
    const alerts = await request(getApp()).get('/api/v1/alerts?limit=100').set(headers);
    expect(alerts.status).toBe(200);
    const serialized = JSON.stringify(alerts.body);
    expect(serialized).not.toContain('Beacon Media');
    expect(serialized).not.toContain('Solstice');

    const suppliers = await request(getApp()).get('/api/v1/suppliers').set(headers);
    const names = JSON.stringify(suppliers.body);
    expect(names).not.toContain('Beacon Media Services');
    expect(names).toContain('Vulcan Steel Supplies');

    const summary = await request(getApp()).get('/api/v1/reports/summary').set(headers);
    // Cross-tenant seeded changes (2 for cascade) are not counted.
    const changes = summary.body.changes as Record<string, number>;
    const total = Object.values(changes).reduce((a, b) => a + b, 0);
    const client = await (await import('../helpers/harness.js')).harness();
    const all = await client.query<{ count: string }>(`SELECT count(*) AS count FROM bank_change_requests`);
    expect(total).toBeLessThan(Number(all.rows[0]!.count));
  });
});

describe('T15: forged authority claims and cross-tenant exports', () => {
  it('ignores client-supplied role/tenant headers entirely', async () => {
    const session = await loginAs('atlas-analyst');
    const forged = {
      ...authHeaders(session, `t15-create-${randomUUID()}`),
      'x-role': 'FINANCE_INITIATOR',
      'x-tenant-id': seedId('tenant:cascade'),
      'x-user-id': seedId('user:cascade-initiator'),
    };
    const response = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(forged)
      .send({
        proposed: {
          accountIdentifier: 'GB00SYNT000012121212',
          beneficiaryName: 'Forged Beneficiary',
          bankName: 'Example Bank',
          currency: 'GBP',
        },
        reason: 'Forged headers must not grant authority.',
      });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('request-body tenant overrides are ignored (tenant comes from the session)', async () => {
    const session = await loginAs('atlas-auditor');
    const response = await request(getApp())
      .get('/api/v1/reports/summary')
      .set({ ...authHeaders(session), 'x-tenant-id': seedId('tenant:cascade') })
      .query({ tenantId: seedId('tenant:cascade') });
    expect(response.status).toBe(200);
    // Still the atlas tenant: recentChanges contain only atlas suppliers.
    const recent = JSON.stringify(response.body.recentChanges);
    expect(recent).not.toContain('Beacon Media');
  });

  it('CSV export is strictly tenant-scoped for a cross-tenant member', async () => {
    // Dana Kross is an auditor in BOTH tenants; the session chooses the scope.
    const atlasSession = await loginAs('cross-auditor');
    const csv = await request(getApp())
      .get('/api/v1/reports/summary?format=csv')
      .set(authHeaders(atlasSession));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    // The CSV contains counters only — no supplier names, no tenant names of others.
    expect(csv.text).not.toContain('Beacon');
    expect(csv.text).not.toContain('Solstice');
    expect(csv.text).toContain('bank_change_state');
  });

  it('non-privileged roles cannot export at all', async () => {
    const session = await loginAs('atlas-initiator');
    const response = await request(getApp())
      .get('/api/v1/reports/summary?format=csv')
      .set(authHeaders(session));
    expect(response.status).toBe(403);
  });
});

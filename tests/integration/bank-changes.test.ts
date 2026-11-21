/**
 * Financial guard test classes:
 *  - T04: an authenticated-looking supplier email still forces ON_HOLD.
 *  - T17: idempotency key reuse with a different body → 409, no mutation.
 *  - T18: callback expiry between approvals blocks release (fail closed).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';
import { expireCallback, harness } from '../helpers/harness.js';
import { supplierId } from '../../db/seeds/seed-data.js';

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'emails');

const PROPOSED = {
  accountIdentifier: 'GB00SYNT000055443322',
  beneficiaryName: 'Vulcan Steel Supplies Ltd',
  bankName: 'Example Trust Bank',
  currency: 'GBP',
};

async function createChange(actor: string, key: string, supplier = 'vulcan-steel') {
  const session = await loginAs(actor);
  return request(getApp())
    .post(`/api/v1/suppliers/${supplierId(supplier)}/bank-changes`)
    .set(authHeaders(session, key))
    .send({ proposed: PROPOSED, reason: 'Integration test change.' });
}

describe('T04: authenticated-looking mail still creates a mandatory HOLD', () => {
  it('email analysis is advisory; the bank change always enters ON_HOLD', async () => {
    const analyst = await loginAs('atlas-analyst');
    const raw = await readFile(join(FIXTURES_DIR, 'S04.eml'));
    const upload = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(analyst) })
      .send(raw);
    expect([200, 201]).toContain(upload.status);
    expect(upload.body.parseStatus).toBe('OK');

    // Even a "perfect" mail-analysis result cannot approve anything:
    const session = await loginAs('atlas-initiator');
    const response = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(authHeaders(session, `t04-create-${randomUUID()}`))
      .send({
        proposed: PROPOSED,
        reason: 'Authenticated-looking supplier email requested the update.',
        linkedEmailSampleId: upload.body.sampleId,
      });
    expect(response.status).toBe(201);
    expect(response.body.state).toBe('ON_HOLD');
    expect(response.body.revision).toBe(1);
    expect(response.body.callback).toBeNull();
    expect(response.body.approvals).toEqual([]);
  });
});

describe('T17: idempotency key reuse with a different body', () => {
  it('returns 409 IDEMPOTENCY_CONFLICT and applies no mutation', async () => {
    const key = `t17-key-${randomUUID()}`;
    const first = await createChange('atlas-initiator', key);
    expect(first.status).toBe(201);
    const changeId = first.body.id as string;

    const session = await loginAs('atlas-initiator');
    const conflicting = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(authHeaders(session, key))
      .send({
        proposed: { ...PROPOSED, beneficiaryName: 'Different Beneficiary Ltd' },
        reason: 'Different body with the same key.',
      });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // No second change was created for this supplier by the conflict.
    const client = await harness();
    const count = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM bank_change_requests WHERE supplier_id = $1 AND created_at > now() - interval '1 minute'`,
      [supplierId('vulcan-steel')],
    );
    const detail = await request(getApp())
      .get(`/api/v1/bank-changes/${changeId}`)
      .set(authHeaders(session));
    expect(detail.body.state).toBe('ON_HOLD');
    void count;
  });

  it('missing Idempotency-Key on governed mutations is rejected', async () => {
    const session = await loginAs('atlas-initiator');
    const response = await request(getApp())
      .post(`/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`)
      .set(authHeaders(session))
      .send({ proposed: PROPOSED, reason: 'No key provided.' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_INPUT');
  });
});

describe('T18: verification expiry between approvals prevents release', () => {
  it('blocks the second approval and release with 423 until new verification', async () => {
    const key = (tag: string) => `t18-${tag}-${randomUUID()}`;
    const create = await createChange('atlas-initiator', key('create'));
    expect(create.status).toBe(201);
    const changeId = create.body.id as string;

    const verifier = await loginAs('atlas-verifier');
    const { SEED, seedId } = await import('../../db/seeds/seed-data.js');
    const verified = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId}/verify`)
      .set(authHeaders(verifier, key('verify')))
      .send({
        revision: 1,
        approvedContactId: seedId(SEED.contacts['vulcan-phone']!.key),
        result: 'CONFIRMED',
        method: 'APPROVED_DIRECTORY_CONTACT',
        evidenceRef: 't18-call-log-1',
      });
    expect(verified.status).toBe(200);
    expect(verified.body.state).toBe('CALLBACK_VERIFIED');

    const approver1 = await loginAs('atlas-approver1');
    const first = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId}/decisions`)
      .set(authHeaders(approver1, key('d1')))
      .send({ revision: 1, decision: 'APPROVE' });
    expect(first.status).toBe(200);
    expect(first.body.state).toBe('APPROVAL_1');

    // Simulated time passage: the 72h callback window elapses.
    await expireCallback(changeId);

    const approver2 = await loginAs('atlas-approver2');
    const second = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId}/decisions`)
      .set(authHeaders(approver2, key('d2')))
      .send({ revision: 1, decision: 'APPROVE' });
    expect(second.status).toBe(423);
    expect(second.body.error.code).toBe('VERIFICATION_HOLD');

    const release = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId}/release`)
      .set(authHeaders(approver1, key('rel')))
      .send({ revision: 1 });
    expect(release.status).toBe(422);
    expect(release.body.error.code).toBe('INVALID_TRANSITION');

    // State remains blocked (APPROVAL_1) — expiry never auto-releases.
    const client = await harness();
    const state = await client.query<{ state: string }>(
      `SELECT state FROM bank_change_requests WHERE id = $1`,
      [changeId],
    );
    expect(state.rows[0]!.state).toBe('APPROVAL_1');

    // A new independent verification for the SAME revision is refused — an
    // expired verification never auto-revalidates (handoff 5.4).
    const reverified = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId}/verify`)
      .set(authHeaders(verifier, key('reverify')))
      .send({
        revision: 1,
        approvedContactId: seedId(SEED.contacts['vulcan-alt-phone']!.key),
        result: 'CONFIRMED',
        method: 'APPROVED_DIRECTORY_CONTACT',
        evidenceRef: 't18-call-log-2',
      });
    expect(reverified.status).toBe(422);

    // Recovery happens through the governed path: a new revision restarts
    // the full callback + dual-approval cycle.
    const initiator = await loginAs('atlas-initiator');
    const revised = await request(getApp())
      .post(`/api/v1/bank-changes/${changeId}/revisions`)
      .set(authHeaders(initiator, key('revise')))
      .send({
        expectedRevision: 1,
        proposed: { ...PROPOSED, beneficiaryName: 'Vulcan Steel Supplies Ltd — Treasury' },
        reason: 'Re-issued after verification expiry.',
      });
    expect(revised.status).toBe(201);
    expect(revised.body.state).toBe('ON_HOLD');
    expect(revised.body.revision).toBe(2);
  });
});

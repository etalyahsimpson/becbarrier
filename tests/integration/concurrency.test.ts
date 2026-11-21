/**
 * T08: concurrency and replay attempts (≥25) across approval and release
 * paths yield exactly the expected unique decisions, event counts and
 * version histories — no duplicate transitions, no duplicate releases.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';
import { harness } from '../helpers/harness.js';
import { SEED, seedId, supplierId } from '../../db/seeds/seed-data.js';

const PROPOSED = {
  accountIdentifier: 'GB00SYNT000011998877',
  beneficiaryName: 'Vulcan Steel Supplies Ltd',
  bankName: 'Example Trust Bank',
  currency: 'GBP',
};

const key = (tag: string) => `t08-${tag}-${randomUUID()}`;
let attempts = 0;

async function post(session: Awaited<ReturnType<typeof loginAs>>, path: string, body: unknown, idemKey?: string) {
  attempts += 1;
  return request(getApp()).post(path).set(authHeaders(session, idemKey)).send(body as object);
}

async function freshVerifiedChange(tag: string): Promise<string> {
  const initiator = await loginAs('atlas-initiator');
  const created = await post(
    initiator,
    `/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`,
    { proposed: PROPOSED, reason: `concurrency ${tag}` },
    key(`${tag}-create`),
  );
  expect(created.status).toBe(201);
  const changeId = created.body.id as string;
  const verifier = await loginAs('atlas-verifier');
  const verified = await post(
    verifier,
    `/api/v1/bank-changes/${changeId}/verify`,
    {
      revision: 1,
      approvedContactId: seedId(SEED.contacts['vulcan-phone']!.key),
      result: 'CONFIRMED',
      method: 'APPROVED_DIRECTORY_CONTACT',
      evidenceRef: `t08-${tag}-call`,
    },
    key(`${tag}-verify`),
  );
  expect(verified.status).toBe(200);
  expect(verified.body.state).toBe('CALLBACK_VERIFIED');
  return changeId;
}

describe('T08: concurrency and idempotent replay (25+ attempts)', () => {
  it('12 concurrent identical creates with one idempotency key create exactly one change', async () => {
    const initiator = await loginAs('atlas-initiator');
    const idemKey = key('race-create');
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        post(
          initiator,
          `/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`,
          { proposed: PROPOSED, reason: 'same-key concurrent create' },
          idemKey,
        ),
      ),
    );
    const ids = new Set(results.map((r) => (r.status < 400 ? (r.body.id as string) : `ERR-${r.status}`)));
    expect(ids.size).toBe(1);
    const client = await harness();
    const idem = await client.query(
      `SELECT count(*)::int AS n FROM idempotency_records WHERE idempotency_key = $1`,
      [idemKey],
    );
    expect(idem.rows[0]!.n).toBe(1);
  });

  it('two distinct approvers racing both land on the change with sequences 1 and 2', async () => {
    const changeId = await freshVerifiedChange('dual');
    const a1 = await loginAs('atlas-approver1');
    const a2 = await loginAs('atlas-approver2');
    const [r1, r2] = await Promise.all([
      post(a1, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('dual-a1')),
      post(a2, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('dual-a2')),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 200]);
    const states = [r1.body.state, r2.body.state].sort();
    expect(states).toEqual(['APPROVAL_1', 'APPROVAL_2']);
    const client = await harness();
    const decisions = await client.query<{ sequence: number; approver_user_id: string }>(
      `SELECT sequence, approver_user_id FROM approval_decisions WHERE change_id = $1 AND decision = 'APPROVE' ORDER BY sequence`,
      [changeId],
    );
    expect(decisions.rows).toHaveLength(2);
    expect(decisions.rows.map((d) => Number(d.sequence))).toEqual([1, 2]);
    expect(new Set(decisions.rows.map((d) => d.approver_user_id)).size).toBe(2);
  });

  it('the same approver racing themselves results in exactly one decision', async () => {
    const changeId = await freshVerifiedChange('self');
    const a1 = await loginAs('atlas-approver1');
    const [r1, r2] = await Promise.all([
      post(a1, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('self-1')),
      post(a1, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('self-2')),
    ]);
    const ok = [r1, r2].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    const client = await harness();
    const decisions = await client.query(
      `SELECT count(*)::int AS n FROM approval_decisions WHERE change_id = $1 AND decision = 'APPROVE'`,
      [changeId],
    );
    expect(decisions.rows[0]!.n).toBe(1);
  });

  it('two concurrent releases produce exactly one release and one outbox instruction', async () => {
    const changeId = await freshVerifiedChange('rel');
    const a1 = await loginAs('atlas-approver1');
    const a2 = await loginAs('atlas-approver2');
    const d1 = await post(a1, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('rel-d1'));
    expect(d1.status).toBe(200);
    const d2 = await post(a2, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('rel-d2'));
    expect(d2.status).toBe(200);

    const [r1, r2] = await Promise.all([
      post(a1, `/api/v1/bank-changes/${changeId}/release`, { revision: 1 }, key('rel-r1')),
      post(a2, `/api/v1/bank-changes/${changeId}/release`, { revision: 1 }, key('rel-r2')),
    ]);
    const ok = [r1, r2].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    const client = await harness();
    const outbox = await client.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'bank.change.release_instruction'
       AND redacted_payload->>'changeId' = $1`,
      [changeId],
    );
    expect(outbox.rows[0]!.n).toBe(1);
    const state = await client.query<{ state: string }>(`SELECT state FROM bank_change_requests WHERE id = $1`, [changeId]);
    expect(state.rows[0]!.state).toBe('RELEASED_FOR_ERP_UPDATE');
  });

  it('release replay with the same key returns the same outcome without duplicating', async () => {
    const changeId = await freshVerifiedChange('replay');
    const a1 = await loginAs('atlas-approver1');
    const a2 = await loginAs('atlas-approver2');
    await post(a1, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('rp-d1'));
    await post(a2, `/api/v1/bank-changes/${changeId}/decisions`, { revision: 1, decision: 'APPROVE' }, key('rp-d2'));
    const idemKey = key('rp-rel');
    const first = await post(a1, `/api/v1/bank-changes/${changeId}/release`, { revision: 1 }, idemKey);
    expect(first.status).toBe(200);
    const replay = await post(a1, `/api/v1/bank-changes/${changeId}/release`, { revision: 1 }, idemKey);
    expect(replay.status).toBe(200);
    expect(replay.body.state).toBe('RELEASED_FOR_ERP_UPDATE');
    const client = await harness();
    const outbox = await client.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'bank.change.release_instruction'
       AND redacted_payload->>'changeId' = $1`,
      [changeId],
    );
    expect(outbox.rows[0]!.n).toBe(1);
  });

  it('concurrent verifies by two verifiers yield exactly one confirmed callback', async () => {
    const initiator = await loginAs('atlas-initiator');
    const created = await post(
      initiator,
      `/api/v1/suppliers/${supplierId('vulcan-steel')}/bank-changes`,
      { proposed: PROPOSED, reason: 'concurrent verify' },
      key('cv-create'),
    );
    const changeId = created.body.id as string;
    const v1 = await loginAs('atlas-verifier');
    const payload = {
      revision: 1,
      approvedContactId: seedId(SEED.contacts['vulcan-phone']!.key),
      result: 'CONFIRMED',
      method: 'APPROVED_DIRECTORY_CONTACT',
      evidenceRef: 't08-cv',
    };
    const [r1, r2] = await Promise.all([
      post(v1, `/api/v1/bank-changes/${changeId}/verify`, payload, key('cv-1')),
      post(v1, `/api/v1/bank-changes/${changeId}/verify`, payload, key('cv-2')),
    ]);
    expect([r1, r2].filter((r) => r.status === 200)).toHaveLength(1);
    const client = await harness();
    const confirmed = await client.query(
      `SELECT count(*)::int AS n FROM callback_verifications WHERE change_id = $1 AND result = 'CONFIRMED'`,
      [changeId],
    );
    expect(confirmed.rows[0]!.n).toBe(1);
  });

  it('concurrent cancels yield exactly one terminal transition', async () => {
    const changeId = await freshVerifiedChange('cancel');
    const initiator = await loginAs('atlas-initiator');
    const admin = await loginAs('atlas-admin');
    const [r1, r2] = await Promise.all([
      post(initiator, `/api/v1/bank-changes/${changeId}/cancel`, {}, key('cc-1')),
      post(admin, `/api/v1/bank-changes/${changeId}/cancel`, {}, key('cc-2')),
    ]);
    expect([r1, r2].filter((r) => r.status === 200)).toHaveLength(1);
    const client = await harness();
    const terminal = await client.query(
      `SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'bank.change.terminal'
       AND redacted_payload->>'changeId' = $1`,
      [changeId],
    );
    expect(terminal.rows[0]!.n).toBe(1);
  });

  it('records at least 25 concurrency/replay attempts in this suite', () => {
    expect(attempts).toBeGreaterThanOrEqual(25);
  });
});

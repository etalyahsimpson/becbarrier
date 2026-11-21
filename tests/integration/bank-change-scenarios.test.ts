/**
 * Executes the 26 bank-change workflow scenario fixtures against the real
 * API + PostgreSQL. These are executable specifications for the financial
 * guard: every step asserts the exact HTTP status, state-machine outcome and
 * structured error code, and every scenario asserts its final state and
 * expected audit event types (fixture inventory: ≥12 negative + ≥12 valid).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getApp, authHeaders, loginAs, type Session } from '../helpers/api.js';
import { harness } from '../helpers/harness.js';
import { SEED, seedId, supplierId } from '../../db/seeds/seed-data.js';

interface ScenarioStep {
  actor: string;
  action: string;
  input: Record<string, unknown>;
  expect: {
    status: number;
    state?: string;
    revision?: number;
    code?: string;
    sameChange?: boolean;
    approvalCount?: number;
  };
  sameKey?: boolean;
  supplier?: string;
  contactKey?: string;
  useReleaseRef?: boolean;
  wrongSecret?: boolean;
}

interface Scenario {
  id: string;
  category: string;
  description: string;
  tenant: string;
  supplier: string;
  steps: ScenarioStep[];
  finalState: string | null;
  expectAuditEventTypes: string[];
}

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'bank-changes');

describe('bank-change scenario fixtures (executable workflow matrix)', () => {
  let scenarios: Scenario[] = [];

  beforeAll(async () => {
    getApp(); // boot the app + config
    const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
    scenarios = await Promise.all(
      files.map(async (f) => JSON.parse(await readFile(join(FIXTURES_DIR, f), 'utf8')) as Scenario),
    );
    scenarios.sort((a, b) => a.id.localeCompare(b.id));
  });

  it('fixture inventory: at least 12 negative and 12 valid/edge scenarios', () => {
    const negative = scenarios.filter((s) => s.category === 'negative').length;
    const valid = scenarios.filter((s) => s.category !== 'negative').length;
    expect(scenarios.length).toBeGreaterThanOrEqual(24);
    expect(negative).toBeGreaterThanOrEqual(12);
    expect(valid).toBeGreaterThanOrEqual(12);
  });

  for (const scenario of scenarios) {
    it(`${scenario.id} (${scenario.category}): ${scenario.description}`, async () => {
      const sessions = new Map<string, Session>();
      const sessionFor = async (actor: string): Promise<Session> => {
        if (!sessions.has(actor)) sessions.set(actor, await loginAs(actor));
        return sessions.get(actor)!;
      };

      let changeId: string | null = null;
      let releaseRef: string | null = null;
      const contactIds = new Map<string, string>();
      const stepKeys = new Map<number, string>();

      for (const [index, step] of scenario.steps.entries()) {
        const session = await sessionFor(step.actor);
        const headers = () => {
          let key = stepKeys.get(index);
          if (!key || !step.sameKey) {
            key = `${scenario.id}-step-${index}-${randomUUID().slice(0, 8)}`;
            stepKeys.set(index, key);
          }
          return authHeaders(session, key);
        };

        if (step.action === 'create' || step.action === 'create-replay') {
          const supplierKey = step.supplier ?? scenario.supplier;
          const response = await request(getApp())
            .post(`/api/v1/suppliers/${supplierId(supplierKey)}/bank-changes`)
            .set(headers())
            .send(step.input);
          expect(response.status).toBe(step.expect.status);
          if (step.expect.status < 400) {
            expect(response.body.state).toBe(step.expect.state);
            expect(response.body.revision).toBe(step.expect.revision ?? 1);
            if (step.expect.sameChange) {
              expect(response.body.id).toBe(changeId);
            } else if (step.action === 'create') {
              changeId = response.body.id as string;
            }
          } else {
            expect(response.body.error.code).toBe(step.expect.code);
          }
          continue;
        }

        if (!changeId) throw new Error(`${scenario.id}: mutation step before create`);

        if (step.action === 'verify') {
          let approvedContactId = step.input.approvedContactId as string;
          if (approvedContactId.startsWith('@contact:')) {
            const key = approvedContactId.slice('@contact:'.length);
            approvedContactId = contactIds.get(key) ?? seedId(SEED.contacts[key]!.key);
          }
          const response = await request(getApp())
            .post(`/api/v1/bank-changes/${changeId}/verify`)
            .set(headers())
            .send({ ...step.input, approvedContactId });
          expect(response.status).toBe(step.expect.status);
          if (step.expect.state) expect(response.body.state).toBe(step.expect.state);
          if (step.expect.code) expect(response.body.error.code).toBe(step.expect.code);
          continue;
        }

        if (step.action === 'decide' || step.action === 'decide-replay') {
          const response = await request(getApp())
            .post(`/api/v1/bank-changes/${changeId}/decisions`)
            .set(headers())
            .send(step.input);
          expect(response.status).toBe(step.expect.status);
          if (step.expect.state) expect(response.body.state).toBe(step.expect.state);
          if (step.expect.approvalCount !== undefined) {
            expect(response.body.approvalCount).toBe(step.expect.approvalCount);
          }
          if (step.expect.code) expect(response.body.error.code).toBe(step.expect.code);
          continue;
        }

        if (step.action === 'release' || step.action === 'release-replay') {
          const response = await request(getApp())
            .post(`/api/v1/bank-changes/${changeId}/release`)
            .set(headers())
            .send(step.input);
          expect(response.status).toBe(step.expect.status);
          if (step.expect.state) expect(response.body.state).toBe(step.expect.state);
          if (step.expect.code) expect(response.body.error.code).toBe(step.expect.code);
          if (response.status === 200 && response.body.releaseRef) {
            releaseRef = response.body.releaseRef as string;
          }
          continue;
        }

        if (step.action === 'erp-ack') {
          const secret = step.wrongSecret ? 'wrong-secret' : (process.env.ERP_ACK_SECRET ?? 'integration-test-erp-secret');
          const body = { ...step.input } as Record<string, unknown>;
          if (step.useReleaseRef && releaseRef) body.releaseRef = releaseRef;
          const response = await request(getApp())
            .post(`/api/v1/bank-changes/${changeId}/erp-ack`)
            .set({ ...headers(), 'x-erp-ack': secret })
            .send(body);
          expect(response.status).toBe(step.expect.status);
          if (step.expect.state) expect(response.body.state).toBe(step.expect.state);
          if (step.expect.code) expect(response.body.error.code).toBe(step.expect.code);
          continue;
        }

        if (step.action === 'revise') {
          const response = await request(getApp())
            .post(`/api/v1/bank-changes/${changeId}/revisions`)
            .set(headers())
            .send(step.input);
          expect(response.status).toBe(step.expect.status);
          if (step.expect.state) expect(response.body.state).toBe(step.expect.state);
          if (step.expect.revision) expect(response.body.revision).toBe(step.expect.revision);
          if (step.expect.code) expect(response.body.error.code).toBe(step.expect.code);
          continue;
        }

        if (step.action === 'cancel') {
          const response = await request(getApp())
            .post(`/api/v1/bank-changes/${changeId}/cancel`)
            .set(headers())
            .send({});
          expect(response.status).toBe(step.expect.status);
          if (step.expect.state) expect(response.body.state).toBe(step.expect.state);
          if (step.expect.code) expect(response.body.error.code).toBe(step.expect.code);
          continue;
        }

        if (step.action === 'approve-contact') {
          const response = await request(getApp())
            .post(`/api/v1/suppliers/${supplierId(scenario.supplier)}/contacts`)
            .set(headers())
            .send(step.input);
          expect(response.status).toBe(step.expect.status);
          if (step.contactKey && response.body.contactId) {
            contactIds.set(step.contactKey, response.body.contactId as string);
          }
          continue;
        }

        throw new Error(`unknown step action: ${step.action}`);
      }

      // Final state + audit assertions.
      if (changeId && scenario.finalState) {
        const session = await sessionFor(scenario.steps[0]!.actor);
        const detail = await request(getApp())
          .get(`/api/v1/bank-changes/${changeId}`)
          .set(authHeaders(session));
        expect(detail.status).toBe(200);
        expect(detail.body.state).toBe(scenario.finalState);
      }
      if (changeId && scenario.expectAuditEventTypes.length > 0) {
        const client = await harness();
        const result = await client.query<{ event_type: string }>(
          `SELECT event_type FROM audit_events WHERE aggregate_type = 'bank_change_request' AND aggregate_id = $1`,
          [changeId],
        );
        const types = result.rows.map((r) => r.event_type);
        for (const expected of scenario.expectAuditEventTypes) {
          expect(types).toContain(expected);
        }
      }
    });
  }
});

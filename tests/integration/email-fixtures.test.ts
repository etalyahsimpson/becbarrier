/**
 * Email fixture pipeline: all 32 synthetic .eml fixtures pass through the
 * REAL API (Express → Python analyzer → PostgreSQL) and the persisted
 * outcomes must match fixtures/emails/expected.json exactly.
 * Covers T01 (API-level oversize 413), T02 (claimed auth never verified) and
 * T16 (safe bounded behavior for adversarial input) at the API boundary.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { getApp, authHeaders, loginAs } from '../helpers/api.js';

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'emails');

interface ExpectedManifest {
  counts: { normal: number; suspicious: number; ambiguous: number; malformed: number; total: number };
  fixtures: Array<{
    id: string;
    category: string;
    expected: {
      digest: string;
      parseStatus: string;
      score: number;
      priority: string | null;
      matchedRules: string[];
      unknownRules: string[];
    };
  }>;
}

describe('email fixture pipeline (32 fixtures, API → analyzer → database)', () => {
  let manifest: ExpectedManifest;
  let session: Awaited<ReturnType<typeof loginAs>>;

  beforeAll(async () => {
    manifest = JSON.parse(await readFile(join(FIXTURES_DIR, 'expected.json'), 'utf8'));
    // The analyzer's approved-domain set comes from the ATLAS tenant's suppliers.
    session = await loginAs('atlas-analyst');
  });

  it('fixture inventory counts match the specification (8/12/6/6 = 32)', () => {
    expect(manifest.counts).toEqual({ normal: 8, suspicious: 12, ambiguous: 6, malformed: 6, total: 32 });
  });

  it('oversized upload is rejected with 413 before persistence (T01)', async () => {
    const big = Buffer.concat([
      Buffer.from('From: a@b.example\nSubject: big\n\n'),
      Buffer.alloc(2 * 1024 * 1024 + 1024, 0x41),
    ]);
    const response = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(big);
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('declared Content-Length over the cap is rejected without buffering (T01)', async () => {
    const response = await request(getApp())
      .post('/api/v1/email-samples')
      .set({
        'content-type': 'message/rfc822',
        'content-length': String(5 * 1024 * 1024),
        ...authHeaders(session),
      })
      .send();
    expect(response.status).toBe(413);
  });

  it('every fixture reproduces its expected analysis through the API', async () => {
    const failures: string[] = [];
    for (const fixture of manifest.fixtures) {
      const raw = await readFile(join(FIXTURES_DIR, `${fixture.id}.eml`));
      const response = await request(getApp())
        .post('/api/v1/email-samples')
        .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
        .send(raw);
      if (fixture.expected.parseStatus === 'REJECTED_OVERSIZE') {
        if (response.status !== 413) {
          failures.push(`${fixture.id}: expected 413, got ${response.status}`);
        }
        continue;
      }
      if (response.status !== 201 && response.status !== 200) {
        failures.push(`${fixture.id}: expected 201/200, got ${response.status} ${JSON.stringify(response.body)}`);
        continue;
      }
      const body = response.body;
      const matched = (body.findings as Array<{ ruleId: string; outcome: string }>)
        .filter((f) => f.outcome === 'MATCH')
        .map((f) => f.ruleId)
        .sort();
      const unknown = (body.findings as Array<{ ruleId: string; outcome: string }>)
        .filter((f) => f.outcome === 'UNKNOWN')
        .map((f) => f.ruleId)
        .sort();
      if (body.parseStatus !== fixture.expected.parseStatus) {
        failures.push(`${fixture.id}: parseStatus ${body.parseStatus} != ${fixture.expected.parseStatus}`);
      }
      if (body.provenance !== 'RAW_UPLOAD') {
        failures.push(`${fixture.id}: provenance must be RAW_UPLOAD for API uploads`);
      }
      if (body.score !== fixture.expected.score) {
        failures.push(`${fixture.id}: score ${body.score} != ${fixture.expected.score}`);
      }
      if ((body.priority ?? null) !== fixture.expected.priority) {
        failures.push(`${fixture.id}: priority ${body.priority} != ${fixture.expected.priority}`);
      }
      if (JSON.stringify(matched) !== JSON.stringify([...fixture.expected.matchedRules].sort())) {
        failures.push(`${fixture.id}: matched ${JSON.stringify(matched)} != ${JSON.stringify(fixture.expected.matchedRules)}`);
      }
      if (JSON.stringify(unknown) !== JSON.stringify([...fixture.expected.unknownRules].sort())) {
        failures.push(`${fixture.id}: unknown ${JSON.stringify(unknown)} != ${JSON.stringify(fixture.expected.unknownRules)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('a claimed SPF/DKIM/DMARC PASS is persisted as an untrusted claim, never verified (T02)', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'S06.eml'));
    const response = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(raw);
    expect([200, 201]).toContain(response.status);
    const detail = await request(getApp())
      .get(`/api/v1/email-samples/${response.body.sampleId}`)
      .set(authHeaders(session));
    const auth = detail.body.normalized.authStatus;
    expect(auth.spf).toBe('UNKNOWN');
    expect(auth.dkim).toBe('NOT_PRESENT'); // S06 carries no DKIM-Signature header, only claims
    expect(auth.dmarc).toBe('NOT_EVALUATED');
    expect(auth.claimTrust).toBe('UNTRUSTED_CLAIM');
    const bec07 = (detail.body.findings as Array<{ ruleId: string; outcome: string }>).find((f) => f.ruleId === 'BEC-07');
    const bec05 = (detail.body.findings as Array<{ ruleId: string; outcome: string }>).find((f) => f.ruleId === 'BEC-05');
    expect(bec07?.outcome).toBe('MATCH');
    expect(bec05?.outcome).toBe('UNKNOWN');
  });

  it('unsafe HTML content is stored as escaped text with no script payload (T16)', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'M05.eml'));
    const response = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(raw);
    expect([200, 201]).toContain(response.status);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('<script>');
    expect(serialized).not.toContain('onload');
    expect(serialized).not.toContain('javascript:');
  });

  it('re-uploading an identical sample replays instead of duplicating (content-addressed)', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'N02.eml'));
    const first = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(raw);
    const second = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(raw);
    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    expect(second.body.sampleId).toBe(first.body.sampleId);
    expect(Boolean(second.body.replay ?? first.body.replay)).toBe(true);
  });

  it('high-priority samples automatically create alerts and cases', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'S02.eml'));
    const response = await request(getApp())
      .post('/api/v1/email-samples')
      .set({ 'content-type': 'message/rfc822', ...authHeaders(session) })
      .send(raw);
    expect([200, 201]).toContain(response.status);
    const detail = await request(getApp())
      .get(`/api/v1/email-samples/${response.body.sampleId}`)
      .set(authHeaders(session));
    expect(detail.body.alert).not.toBeNull();
    expect(detail.body.alert.priority).toBe('CRITICAL');
    expect(detail.body.alert.case_id).toBeTruthy();
  });
});

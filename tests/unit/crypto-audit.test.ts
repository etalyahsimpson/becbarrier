/** Payment cryptography and audit-chain integrity (packages/security). */
import {
  auditKeyVersion,
  canonicalJson,
  computeEventHmac,
  createContextKey,
  GENESIS_HASH,
  newSessionPayload,
  sha256Hex,
  signSession,
  uuidV5,
  verifyChain,
  verifySession,
  type AuditEventRecord,
} from '@becbarrier/security';

const KEY = 'ab'.repeat(32);
const CONTEXT = { tenantId: 't-1', supplierId: 's-1', revision: 1 };

describe('AES-256-GCM payment encryption', () => {
  it('round-trips with authenticated context', () => {
    const crypto = createContextKey(KEY);
    const payload = JSON.stringify({ accountIdentifier: 'GB00SYNT00001122', beneficiaryName: 'X' });
    const envelope = crypto.encryptBankPayload(payload, CONTEXT);
    expect(envelope.v).toBe(1);
    expect(envelope.ciphertext).not.toContain('GB00SYNT');
    expect(crypto.decryptBankPayload(envelope, CONTEXT)).toBe(payload);
  });

  it('refuses to decrypt under a different tenant/supplier/revision context', () => {
    const crypto = createContextKey(KEY);
    const envelope = crypto.encryptBankPayload('secret-value', CONTEXT);
    expect(() => crypto.decryptBankPayload(envelope, { ...CONTEXT, revision: 2 })).toThrow();
    expect(() => crypto.decryptBankPayload(envelope, { ...CONTEXT, tenantId: 'other' })).toThrow();
  });

  it('rejects weak key material outright', () => {
    expect(() => createContextKey('short')).toThrow(/INVALID_KEY_CONFIGURATION/);
    expect(() => createContextKey('zz'.repeat(32))).toThrow(/INVALID_KEY_CONFIGURATION/);
  });

  it('fingerprints are stable and keyed', () => {
    const crypto = createContextKey(KEY);
    expect(crypto.fingerprint('GB00SYNT00001122')).toBe(crypto.fingerprint('GB00SYNT00001122'));
    expect(crypto.fingerprint('GB00SYNT00001122')).not.toBe(crypto.fingerprint('GB00SYNT00001123'));
    expect(crypto.fingerprint('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('signed sessions', () => {
  it('round-trips and rejects tampering', () => {
    const payload = newSessionPayload('user-1', 'tenant-1', 60);
    const { sessionToken, csrfToken } = signSession(KEY, payload);
    expect(verifySession(KEY, sessionToken)?.sub).toBe('user-1');
    expect(verifySession('cd'.repeat(32), sessionToken)).toBeNull();
    expect(verifySession(KEY, `${sessionToken}x`)).toBeNull();
    expect(csrfToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects expired sessions', () => {
    const expired = { ...newSessionPayload('u', 't', 60), exp: Math.floor(Date.now() / 1000) - 10 };
    const { sessionToken } = signSession(KEY, expired);
    expect(verifySession(KEY, sessionToken)).toBeNull();
  });
});

describe('audit chain', () => {
  const baseEvent = {
    tenantId: 't-1',
    aggregateType: 'bank_change_request',
    aggregateId: 'c-1',
    aggregateVersion: 1,
    actorUserId: 'u-1',
    eventType: 'BANK_CHANGE_CREATED',
    eventTime: '2026-11-20T09:00:00.000Z',
    safeMetadata: { maskedSuffix: '•••• 2233' },
  };

  function chainOf(events: Array<Partial<typeof baseEvent> & { id: string; eventType: string }>): AuditEventRecord[] {
    let prev = GENESIS_HASH;
    return events.map((event, index) => {
      const record = {
        ...baseEvent,
        ...event,
        sequence: index + 1,
        prevEventHash: prev,
      };
      const hmac = computeEventHmac(KEY, { ...record });
      const full = { ...record, eventHmac: hmac, keyVersion: auditKeyVersion() };
      prev = hmac;
      return full;
    });
  }

  it('verifies an honest chain', () => {
    const chain = chainOf([
      { id: 'e1', eventType: 'BANK_CHANGE_CREATED' },
      { id: 'e2', eventType: 'BANK_CHANGE_HOLD' },
    ]);
    const verification = verifyChain(KEY, chain);
    expect(verification.ok).toBe(true);
    expect(verification.checkedCount).toBe(2);
  });

  it('detects edited event data (HMAC mismatch)', () => {
    const chain = chainOf([
      { id: 'e1', eventType: 'BANK_CHANGE_CREATED' },
      { id: 'e2', eventType: 'BANK_CHANGE_HOLD' },
    ]);
    chain[1]!.safeMetadata = { tampered: true };
    const verification = verifyChain(KEY, chain);
    expect(verification.ok).toBe(false);
    expect(verification.failures[0]).toMatchObject({ reason: expect.stringContaining('HMAC_MISMATCH') });
  });

  it('detects missing entries (sequence gap and prev-hash break)', () => {
    const chain = chainOf([
      { id: 'e1', eventType: 'A' },
      { id: 'e2', eventType: 'B' },
      { id: 'e3', eventType: 'C' },
    ]);
    const withGap = [chain[0]!, chain[2]!];
    const verification = verifyChain(KEY, withGap);
    expect(verification.ok).toBe(false);
    expect(verification.failures.some((f) => f.reason.includes('SEQUENCE_GAP'))).toBe(true);
    expect(verification.failures.some((f) => f.reason.includes('PREV_HASH_MISMATCH'))).toBe(true);
  });
});

describe('deterministic ids', () => {
  it('uuidV5 is stable and well-formed', () => {
    const a = uuidV5('supplier:vulcan-steel');
    const b = uuidV5('supplier:vulcan-steel');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV5('supplier:other')).not.toBe(a);
  });

  it('canonical json is order-independent', () => {
    expect(canonicalJson({ a: 1, b: [2, { c: 3 }] })).toBe(canonicalJson({ b: [2, { c: 3 }], a: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it('sha256Hex digests', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('x')).toBe(sha256Hex('x'));
  });
});

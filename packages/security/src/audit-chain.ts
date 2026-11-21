import { createHmac } from 'node:crypto';
import { parseKey } from './payment-crypto.js';

/**
 * HMAC-linked, tenant-scoped audit chain (handoff section 7.7).
 *
 * Each audit event stores: event id, tenant, aggregate, actor, type, time,
 * redacted metadata, the previous event's HMAC, and its own HMAC over the
 * canonical encoding. The verifier recomputes the sequence and detects
 * ordinary application-level edits or missing entries.
 *
 * Bounded threat model: an attacker with BOTH database write access AND the
 * audit HMAC key could rewrite a chain. This deters ordinary application
 * tampering; it is not claimed to be absolutely immutable. External write-once
 * retention is a production hardening option.
 */

export interface AuditEventRecord {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  actorUserId: string | null;
  eventType: string;
  eventTime: string; // ISO-8601 UTC
  safeMetadata: Record<string, unknown>;
  sequence: number;
  prevEventHash: string;
  eventHmac: string;
  keyVersion: string;
}

/** Deterministic canonical JSON: sorted keys, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  return serialize(value);

  function serialize(v: unknown): string {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(serialize).join(',')}]`;
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${serialize(val)}`).join(',')}}`;
    }
    throw new Error('CANONICAL_JSON_UNSUPPORTED_TYPE');
  }
}

export const AUDIT_KEY_VERSION = 'audit-hmac-v1';
export const GENESIS_HASH = 'GENESIS';

export function auditKeyVersion(): string {
  return AUDIT_KEY_VERSION;
}

export interface AuditChainInput {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  actorUserId: string | null;
  eventType: string;
  eventTime: string;
  safeMetadata: Record<string, unknown>;
  sequence: number;
  prevEventHash: string;
}

export function computeEventHmac(auditKeyHex: string, input: AuditChainInput): string {
  const key = parseKey(auditKeyHex, 'AUDIT_HMAC_KEY');
  const canonical = canonicalJson({
    id: input.id,
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    eventTime: input.eventTime,
    safeMetadata: input.safeMetadata,
    sequence: input.sequence,
    prevEventHash: input.prevEventHash,
  });
  return createHmac('sha256', key).update(canonical).digest('hex');
}

export interface ChainVerification {
  ok: boolean;
  tenantId: string;
  checkedCount: number;
  failures: Array<{ sequence: number; eventId?: string; reason: string }>;
}

/** Recompute the whole chain for one tenant in sequence order. */
export function verifyChain(auditKeyHex: string, events: AuditEventRecord[]): ChainVerification {
  const failures: ChainVerification['failures'] = [];
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const ev of events) {
    if (ev.sequence !== expectedSeq) {
      failures.push({ sequence: expectedSeq, eventId: ev.id, reason: `SEQUENCE_GAP expected ${expectedSeq} got ${ev.sequence}` });
    }
    if (ev.prevEventHash !== prev) {
      failures.push({ sequence: ev.sequence, eventId: ev.id, reason: 'PREV_HASH_MISMATCH' });
    }
    const recomputed = computeEventHmac(auditKeyHex, {
      id: ev.id,
      tenantId: ev.tenantId,
      aggregateType: ev.aggregateType,
      aggregateId: ev.aggregateId,
      aggregateVersion: ev.aggregateVersion,
      actorUserId: ev.actorUserId,
      eventType: ev.eventType,
      eventTime: ev.eventTime,
      safeMetadata: ev.safeMetadata,
      sequence: ev.sequence,
      prevEventHash: ev.prevEventHash,
    });
    if (recomputed !== ev.eventHmac) {
      failures.push({ sequence: ev.sequence, eventId: ev.id, reason: 'HMAC_MISMATCH (event edited or forged)' });
    }
    prev = ev.eventHmac;
    expectedSeq += 1;
  }
  return {
    ok: failures.length === 0,
    tenantId: events[0]?.tenantId ?? 'unknown',
    checkedCount: events.length,
    failures,
  };
}

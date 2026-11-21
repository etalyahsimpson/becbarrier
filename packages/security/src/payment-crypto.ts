import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Payment-data cryptography (handoff sections 5.3 and 8.5 of the master spec).
 *
 * - AES-256-GCM authenticated encryption with unique nonces and authenticated
 *   context (tenant/supplier/revision) bound as AAD.
 * - Separate HMAC-SHA-256 keyed fingerprints for stable equality comparison of
 *   low-entropy bank numbers (never unkeyed hashes).
 * - Keys are supplied by runtime configuration only; key material is never
 *   persisted or logged, only a key identifier is stored.
 */

export interface PaymentCrypto {
  readonly keyId: string;
  encryptBankPayload(plaintext: string, context: BankFieldContext): EncryptedPayload;
  decryptBankPayload(payload: EncryptedPayload, context: BankFieldContext): string;
  fingerprint(canonicalValue: string): string;
}

export interface BankFieldContext {
  tenantId: string;
  supplierId: string;
  revision: number;
}

/** v1 envelope: base64(nonce(12) | ciphertext | tag(16)) + keyId + context digest. */
export interface EncryptedPayload {
  v: 1;
  keyId: string;
  ciphertext: string;
  contextDigest: string;
}

const ALGO = 'aes-256-gcm';

export function createContextKey(hexKey: string): PaymentCrypto {
  const key = parseKey(hexKey, 'PAYMENT_ENCRYPTION_KEY');
  const fpKey = parseKey(hexKey, 'PAYMENT_FINGERPRINT_KEY');
  const keyId = createHmac('sha256', key).update('becbarrier-key-id-v1').digest('hex').slice(0, 16);
  return {
    keyId,
    encryptBankPayload(plaintext: string, context: BankFieldContext): EncryptedPayload {
      const aad = contextAad(context);
      const nonce = randomBytes(12);
      const cipher = createCipheriv(ALGO, key, nonce, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        v: 1,
        keyId,
        ciphertext: Buffer.concat([nonce, enc, tag]).toString('base64'),
        contextDigest: createHmac('sha256', fpKey).update(aad).digest('hex').slice(0, 32),
      };
    },
    decryptBankPayload(payload: EncryptedPayload, context: BankFieldContext): string {
      if (payload.v !== 1) throw new Error('UNSUPPORTED_ENVELOPE');
      const raw = Buffer.from(payload.ciphertext, 'base64');
      if (raw.length < 12 + 16) throw new Error('CIPHERTEXT_TOO_SHORT');
      const nonce = raw.subarray(0, 12);
      const tag = raw.subarray(raw.length - 16);
      const body = raw.subarray(12, raw.length - 16);
      const decipher = createDecipheriv(ALGO, key, nonce, { authTagLength: 16 });
      decipher.setAAD(Buffer.from(contextAad(context), 'utf8'));
      decipher.setAuthTag(tag);
      const out = Buffer.concat([decipher.update(body), decipher.final()]);
      return out.toString('utf8');
    },
    fingerprint(canonicalValue: string): string {
      return createHmac('sha256', fpKey).update(`bbfp:v1:${canonicalValue}`).digest('hex');
    },
  };
}

function contextAad(ctx: BankFieldContext): string {
  return `tenant=${ctx.tenantId}|supplier=${ctx.supplierId}|revision=${ctx.revision}`;
}

export function parseKey(hexKey: string, name: string): Buffer {
  const clean = (hexKey ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(
      `INVALID_KEY_CONFIGURATION:${name}: expected 64 hex chars (32 bytes). Refusing to start with weak or missing key material.`,
    );
  }
  return Buffer.from(clean, 'hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

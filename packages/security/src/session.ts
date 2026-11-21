import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseKey, safeEqual } from './payment-crypto.js';

/**
 * Stateless signed sessions (HS256-style, implemented on node:crypto so the
 * token surface stays small and auditable). The cookie carries the session;
 * roles and tenant membership are ALWAYS re-resolved server-side from
 * PostgreSQL on every request — the token never carries authority claims.
 */

export interface SessionPayload {
  sub: string; // userId
  tenantId: string;
  sid: string;
  csrfSecret: string;
  iat: number;
  exp: number;
}

export interface SessionTokens {
  sessionToken: string;
  csrfToken: string;
  payload: SessionPayload;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

export function signSession(
  signingKeyHex: string,
  payload: SessionPayload,
): SessionTokens {
  const key = parseKey(signingKeyHex, 'SESSION_SIGNING_KEY');
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  const csrfToken = createHmac('sha256', key).update(`csrf:${payload.sid}:${payload.csrfSecret}`).digest('hex');
  return { sessionToken: `${body}.${sig}`, csrfToken, payload };
}

export function verifySession(
  signingKeyHex: string,
  token: string,
): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const key = parseKey(signingKeyHex, 'SESSION_SIGNING_KEY');
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== 'string' || typeof payload.tenantId !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export function csrfTokenFor(signingKeyHex: string, sid: string, csrfSecret: string): string {
  const key = parseKey(signingKeyHex, 'SESSION_SIGNING_KEY');
  return createHmac('sha256', key).update(`csrf:${sid}:${csrfSecret}`).digest('hex');
}

export function newSessionPayload(userId: string, tenantId: string, ttlSeconds: number): SessionPayload {
  return {
    sub: userId,
    tenantId,
    sid: randomUUID(),
    csrfSecret: randomUUID().replace(/-/g, ''),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
}

export { safeEqual };

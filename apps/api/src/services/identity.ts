import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import type { AppConfig } from '../config.js';
import { err } from '../middleware/error.js';

/**
 * Identity boundary.
 *
 * Local demo adapter (development/test ONLY): the demo identities are seeded
 * synthetic users; login is a dev-only route that mints a signed session.
 * This adapter does NOT constitute enterprise authentication and is disabled
 * by configuration in production (config boot fails closed without OIDC).
 *
 * OIDC adapter: authorization-code flow with PKCE, wired for a real
 * enterprise identity provider. The token exchange executes only when a real
 * issuer is configured; nothing is simulated as if operational.
 */

export interface DemoIdentityRow {
  userId: string;
  userName: string;
  email: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
}

export async function listDemoIdentities(db: Db): Promise<DemoIdentityRow[]> {
  const result = await db.query<DemoIdentityRow>(
    `SELECT u.id AS "userId", u.display_name AS "userName", u.email,
            t.id AS "tenantId", t.name AS "tenantName", t.slug AS "tenantSlug", m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.active AND u.status = 'ACTIVE'
     ORDER BY t.slug, m.role, u.display_name`,
  );
  return result.rows;
}

export async function resolveDemoLogin(db: Db, userId: string, tenantId: string): Promise<DemoIdentityRow> {
  const result = await db.query<DemoIdentityRow>(
    `SELECT u.id AS "userId", u.display_name AS "userName", u.email,
            t.id AS "tenantId", t.name AS "tenantName", t.slug AS "tenantSlug", m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND m.tenant_id = $2 AND m.active AND u.status = 'ACTIVE'
     LIMIT 1`,
    [userId, tenantId],
  );
  const row = result.rows[0];
  if (!row) {
    throw err('UNAUTHENTICATED', 'Demo identity not found or inactive.');
  }
  return row;
}

export function assertDemoIdentityAllowed(config: AppConfig): void {
  if (!config.demoIdentityEnabled) {
    throw err('NOT_FOUND_IN_TENANT', 'Not found.');
  }
}

/** PKCE helpers for the future enterprise OIDC deployment. */
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface OidcEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
}

/**
 * Builds the OIDC authorization-code + PKCE redirect. Requires a configured
 * issuer; no simulated provider. Caller must complete discovery/token
 * exchange with the real IdP before a production session is issued.
 */
export function buildOidcAuthorizeRedirect(config: AppConfig, state: string, redirectUri: string): string {
  if (!config.oidc) {
    throw err('TEMPORARILY_UNAVAILABLE', 'No OIDC provider configured.');
  }
  const { challenge } = generatePkcePair();
  const url = new URL(config.oidc.issuerUrl.replace(/\/$/, '') + '/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.oidc.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

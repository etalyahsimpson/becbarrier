/**
 * Runtime configuration. Loaded from environment variables only.
 *
 * Fail-closed rules:
 * - APP_ENV=production requires a real OIDC provider configuration; the local
 *   demo identity adapter is hard-disabled and boot aborts without an IdP.
 * - Required key material must be 32-byte hex values; the process refuses to
 *   start with missing or weak keys rather than silently falling back.
 */

export type AppEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  appEnv: AppEnv;
  port: number;
  databaseUrl: string;
  redisUrl: string | null;
  sessionSigningKey: string;
  paymentEncryptionKey: string;
  auditHmacKey: string;
  internalServiceToken: string;
  erpAckSecret: string;
  emailIntelligenceUrl: string;
  uploadMaxBytes: number;
  callbackExpiryHours: number;
  sessionTtlSeconds: number;
  webOrigin: string;
  demoIdentityEnabled: boolean;
  oidc: { issuerUrl: string; clientId: string } | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`MISSING_CONFIGURATION:${name} — refusing to start.`);
  }
  return value.trim();
}

function requireHexKey(name: string): string {
  const value = requireEnv(name);
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `INVALID_KEY_CONFIGURATION:${name} — expected 64 hex chars (32 bytes). Generate with: openssl rand -hex 32`,
    );
  }
  return value.toLowerCase();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnv = (env.APP_ENV ?? 'development') as AppEnv;
  if (!['development', 'test', 'production'].includes(appEnv)) {
    throw new Error(`INVALID_CONFIGURATION:APP_ENV=${appEnv}`);
  }

  const demoIdentityEnabled = appEnv === 'development' || appEnv === 'test';
  const oidcIssuer = env.OIDC_ISSUER_URL?.trim() || '';
  const oidcClientId = env.OIDC_CLIENT_ID?.trim() || '';

  if (appEnv === 'production' && (!oidcIssuer || !oidcClientId)) {
    throw new Error(
      'FAIL_CLOSED: APP_ENV=production requires OIDC_ISSUER_URL and OIDC_CLIENT_ID. ' +
        'The local demo identity adapter is not available in production and no identity provider is configured.',
    );
  }

  return {
    appEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: env.REDIS_URL?.trim() || null,
    sessionSigningKey: requireHexKey('SESSION_SIGNING_KEY'),
    paymentEncryptionKey: requireHexKey('PAYMENT_ENCRYPTION_KEY'),
    auditHmacKey: requireHexKey('AUDIT_HMAC_KEY'),
    internalServiceToken: requireEnv('INTERNAL_SERVICE_TOKEN'),
    erpAckSecret: requireEnv('ERP_ACK_SECRET'),
    emailIntelligenceUrl: env.EMAIL_INTELLIGENCE_URL?.trim() || 'http://localhost:8001',
    uploadMaxBytes: Number(env.UPLOAD_MAX_BYTES ?? 2097152),
    callbackExpiryHours: Number(env.CALLBACK_EXPIRY_HOURS ?? 72),
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS ?? 8 * 3600),
    webOrigin: env.WEB_ORIGIN?.trim() || 'http://localhost:3000',
    demoIdentityEnabled,
    oidc: oidcIssuer && oidcClientId ? { issuerUrl: oidcIssuer, clientId: oidcClientId } : null,
  };
}

/**
 * Per-worker test environment setup. Loads .env.test when present (local
 * development) and merges the runtime coordination file written by the Jest
 * global setup (email-intelligence URL). Runs BEFORE any test module loads.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from '../env-loader.js';

const root = process.cwd();

// 1) .env.test (local only; never committed — see .gitignore)
for (const [key, value] of Object.entries(loadEnvFile(join(root, '.env.test')))) {
  if (!process.env[key]) process.env[key] = value;
}

// 2) coordination file from global setup (email-intelligence service URL)
const coordPath = join(root, '.jest-runtime.json');
if (existsSync(coordPath)) {
  try {
    const coord = JSON.parse(readFileSync(coordPath, 'utf8')) as Record<string, string>;
    for (const [key, value] of Object.entries(coord)) {
      process.env[key] = value;
    }
  } catch {
    // ignore — tests will fail loudly if the URL is missing
  }
}

// 3) deterministic TEST-ONLY key material when the harness did not provide
//    any. These keys protect nothing real; production refuses weak/missing
//    keys regardless.
const testDefaults: Record<string, string> = {
  APP_ENV: 'test',
  PORT: '4100',
  SESSION_SIGNING_KEY: 'a1'.repeat(32),
  PAYMENT_ENCRYPTION_KEY: 'b2'.repeat(32),
  AUDIT_HMAC_KEY: 'c3'.repeat(32),
  INTERNAL_SERVICE_TOKEN: 'integration-test-internal-token',
  ERP_ACK_SECRET: 'integration-test-erp-secret',
  EMAIL_RULESET_VERSION: 'bec-rules-v1',
  CALLBACK_EXPIRY_HOURS: '72',
  UPLOAD_MAX_BYTES: '2097152',
};
for (const [key, value] of Object.entries(testDefaults)) {
  if (!process.env[key]) process.env[key] = value;
}

/**
 * Jest global setup (plain CJS — jest loads globalSetup outside ts-jest).
 *  1. Loads .env.test (local) or inherits CI environment.
 *  2. Applies migrations + roles + synthetic seed to the test database.
 *  3. Spawns the Python email-intelligence service (uvicorn) and publishes
 *     its URL via .jest-runtime.json for the per-worker setup file.
 */
const { execSync, spawn } = require('node:child_process');
const { existsSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const runtimeFile = join(root, '.jest-runtime.json');
const PY_PORT = 8010;

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of require('node:fs').readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

module.exports = async function globalSetup() {
  for (const [key, value] of Object.entries(loadEnvFile(join(root, '.env.test')))) {
    if (!process.env[key]) process.env[key] = value;
  }
  for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    if (!process.env[key]) {
      throw new Error(`${key} is required for integration tests (env or local .env.test).`);
    }
  }
  const defaults = {
    APP_ENV: 'test',
    SESSION_SIGNING_KEY: 'a1'.repeat(32),
    PAYMENT_ENCRYPTION_KEY: 'b2'.repeat(32),
    AUDIT_HMAC_KEY: 'c3'.repeat(32),
    INTERNAL_SERVICE_TOKEN: 'integration-test-internal-token',
    ERP_ACK_SECRET: 'integration-test-erp-secret',
    DB_API_PASSWORD: 'bb_api_test_password',
    DB_WORKER_PASSWORD: 'bb_worker_test_password',
    DB_AUDIT_PASSWORD: 'bb_audit_ro_test_password',
    CALLBACK_EXPIRY_HOURS: '72',
    UPLOAD_MAX_BYTES: '2097152',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) process.env[key] = value;
  }

  const env = { ...process.env };
  execSync('npx tsx db/migrate.ts up', { cwd: root, env, stdio: 'pipe' });
  execSync('npx tsx db/setup-roles.ts', { cwd: root, env, stdio: 'pipe' });
  execSync('npx tsx db/seeds/seed.ts', { cwd: root, env, stdio: 'pipe' });

  const emailIntelUrl = `http://127.0.0.1:${PY_PORT}`;
  const child = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(PY_PORT)], {
    cwd: join(root, 'services', 'email-intelligence'),
    env,
    stdio: 'ignore',
  });
  if (!(await waitForHealth(`${emailIntelUrl}/internal/v1/health`, 30000))) {
    child.kill('SIGTERM');
    throw new Error('email-intelligence service failed to start within 30s');
  }

  if (existsSync(runtimeFile)) rmSync(runtimeFile);
  writeFileSync(runtimeFile, JSON.stringify({ EMAIL_INTELLIGENCE_URL: emailIntelUrl, EMAIL_INTEL_PID: String(child.pid) }));
  console.log('[global-setup] test database ready; email-intelligence on', emailIntelUrl);
};

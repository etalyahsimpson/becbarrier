/** Jest global teardown: stop the spawned email-intelligence service. */
const { readFileSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async function globalTeardown() {
  const runtimeFile = join(__dirname, '..', '..', '.jest-runtime.json');
  try {
    if (existsSync(runtimeFile)) {
      const coord = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      if (coord.EMAIL_INTEL_PID) {
        try { process.kill(Number(coord.EMAIL_INTEL_PID), 'SIGTERM'); } catch {}
      }
    }
  } finally {
    try { rmSync(runtimeFile); } catch {}
  }
  await new Promise((r) => setTimeout(r, 300));
};

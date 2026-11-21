/** Minimal .env-style loader for tests (no external dependency). */
import { existsSync, readFileSync } from 'node:fs';

export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, value] = match;
    out[key!] = value!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

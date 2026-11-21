import { SEVERITY_WEIGHTS, Severity } from '@becbarrier/contracts';

/**
 * Deterministic alert prioritization (handoff section 3.4).
 * Transparent triage heuristic — NOT a calibrated fraud probability.
 * A score of 0 means "no rules fired", never "safe".
 */

export function computeScore(triggered: { severity: Severity }[]): number {
  let total = 0;
  for (const f of triggered) {
    total += SEVERITY_WEIGHTS[f.severity];
  }
  return Math.min(100, total);
}

export function scoreToPriority(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'NONE' {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'NONE';
}

/** Normalize an account identifier for comparison (IBAN-style: strip spaces, upper-case). */
export function canonicalAccountIdentifier(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** Mask an account identifier to its last four characters only. */
export function maskAccountSuffix(raw: string): string {
  const canonical = canonicalAccountIdentifier(raw);
  if (canonical.length <= 4) return '****';
  return `•••• ${canonical.slice(-4)}`;
}

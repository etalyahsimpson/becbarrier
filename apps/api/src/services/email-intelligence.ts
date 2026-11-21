import type { AppConfig } from '../config.js';
import { err } from '../middleware/error.js';
import { emailAnalysisResponseSchema, type EmailAnalysisResponse } from '@becbarrier/contracts';

/**
 * Internal client for the Python email-intelligence service.
 * The service is non-authoritative: it never writes business state and is
 * reachable only with the internal service token over the restricted network.
 */

export interface AnalyzeEmailInput {
  contentBase64: string;
  provenance: 'RAW_UPLOAD' | 'SYNTHETIC_FIXTURE';
  approvedDomains: string[];
  approvedAliases: string[];
}

export async function analyzeEmail(
  config: AppConfig,
  input: AnalyzeEmailInput,
): Promise<EmailAnalysisResponse> {
  const url = `${config.emailIntelligenceUrl.replace(/\/$/, '')}/internal/v1/analyze-email`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-service-token': config.internalServiceToken,
      },
      body: JSON.stringify({
        content_base64: input.contentBase64,
        provenance: input.provenance,
        approved_domains: input.approvedDomains,
        approved_aliases: input.approvedAliases,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw err(
      'EMAIL_ANALYSIS_UNAVAILABLE',
      'The email-intelligence service is unavailable; the sample was not persisted.',
      { cause: e instanceof Error ? e.message : 'unknown' },
    );
  }

  if (response.status === 413) {
    throw err('PAYLOAD_TOO_LARGE', 'The email sample exceeds the configured size limit.');
  }
  if (response.status === 422) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw err('MALFORMED_INPUT', 'The email payload was rejected by the analyzer.', body?.detail ?? undefined);
  }
  if (!response.ok) {
    throw err('EMAIL_ANALYSIS_UNAVAILABLE', `Analyzer responded with HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  const parsed = emailAnalysisResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw err('EMAIL_ANALYSIS_UNAVAILABLE', 'Analyzer returned an invalid response contract.', {
      issues: parsed.error.issues.slice(0, 5),
      received: JSON.stringify(body).slice(0, 300),
    });
  }
  return parsed.data;
}

export async function checkEmailIntelligenceHealth(config: AppConfig): Promise<boolean> {
  try {
    const response = await fetch(
      `${config.emailIntelligenceUrl.replace(/\/$/, '')}/internal/v1/health`,
      { signal: AbortSignal.timeout(2_000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

import { randomUUID } from 'node:crypto';
import type { Db, DbClient } from '../db.js';
import type { AppConfig } from '../config.js';
import { err, type ActorState } from '../middleware/error.js';
import type { EmailAnalysisResponse } from '@becbarrier/contracts';
import { appendAuditEventWithConfig, AuditEventTypes } from './audit.js';
import { insertOutboxEvent, OutboxEventTypes } from './outbox.js';
import { analyzeEmail } from './email-intelligence.js';

/**
 * Email intake: bounded .eml upload → internal Python analysis → tenant-
 * scoped persistence of findings/alerts/cases. The upload is untrusted
 * content; all apparent security headers are treated as claims, never as
 * verified delivery telemetry (provenance RAW_UPLOAD).
 */

export interface EmailSampleRow {
  id: string;
  tenant_id: string;
  source_digest: string;
  provenance: string;
  parse_status: string;
  parsed_headers_json: Record<string, unknown>;
  normalized_fields_json: Record<string, unknown>;
  rule_version: string;
  score: number;
  priority: string | null;
  unknown_count: number;
  subject_display: string;
  uploader_user_id: string | null;
  created_at: Date;
}

export interface PreparedAnalysis {
  analysis: EmailAnalysisResponse;
}

export async function prepareEmailAnalysis(
  db: Db,
  config: AppConfig,
  actor: ActorState,
  rawBytes: Buffer,
): Promise<PreparedAnalysis> {
  if (rawBytes.length === 0) {
    throw err('MALFORMED_INPUT', 'Empty upload.');
  }
  if (rawBytes.length > config.uploadMaxBytes) {
    throw err('PAYLOAD_TOO_LARGE', `The .eml exceeds the ${config.uploadMaxBytes}-byte limit.`);
  }

  // Approved supplier domains/aliases come from the tenant-checked database,
  // never from the browser (trust boundary, master spec section 5).
  const supplierResult = await db.query<{ approved_domains: Array<{ domain: string; aliasOf?: string }> }>(
    `SELECT approved_domains FROM suppliers WHERE tenant_id = $1`,
    [actor.tenantId],
  );
  const approvedDomains: string[] = [];
  const approvedAliases: string[] = [];
  for (const row of supplierResult.rows) {
    for (const entry of row.approved_domains ?? []) {
      if (entry.aliasOf) approvedAliases.push(entry.domain.toLowerCase());
      else approvedDomains.push(entry.domain.toLowerCase());
    }
  }

  const analysis = await analyzeEmail(config, {
    contentBase64: rawBytes.toString('base64'),
    provenance: 'RAW_UPLOAD',
    approvedDomains,
    approvedAliases,
  });
  return { analysis };
}

export async function persistEmailSample(
  client: DbClient,
  config: AppConfig,
  actor: ActorState,
  analysis: EmailAnalysisResponse,
): Promise<{ sampleId: string; replay: boolean; alertId: string | null }> {
  {
    // Content-addressed: re-uploading the same sample is a replay, not a duplicate.
    const existing = await client.query<EmailSampleRow>(
      `SELECT * FROM email_samples WHERE tenant_id = $1 AND source_digest = $2 LIMIT 1`,
      [actor.tenantId, analysis.digest],
    );
    if (existing.rows[0]) {
      return { sampleId: existing.rows[0].id, replay: true, alertId: null };
    }

    const sampleId = randomUUID();
    await client.query(
      `INSERT INTO email_samples
         (id, tenant_id, source_digest, provenance, parse_status, parsed_headers_json,
          normalized_fields_json, rule_version, score, priority, unknown_count,
          subject_display, uploader_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        sampleId,
        actor.tenantId,
        analysis.digest,
        analysis.provenance,
        analysis.parseStatus,
        JSON.stringify((analysis.normalized as Record<string, unknown>).parsedHeaders ?? {}),
        JSON.stringify(analysis.normalized ?? {}),
        analysis.ruleVersion,
        analysis.score,
        analysis.priority === 'NONE' ? null : analysis.priority,
        analysis.unknownCount,
        subjectOf(analysis),
        actor.userId,
      ],
    );
    for (const finding of analysis.findings) {
      await client.query(
        `INSERT INTO email_findings
           (id, tenant_id, email_sample_id, rule_id, rule_version, outcome, severity,
            provenance, explanation, evidence_field, masked_excerpt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(), actor.tenantId, sampleId, finding.ruleId, finding.version,
          finding.outcome, finding.severity, finding.provenance, finding.explanation,
          finding.evidenceField ?? null, finding.maskedExcerpt ?? null,
        ],
      );
    }

    let alertId: string | null = null;
    let caseId: string | null = null;
    const matched = analysis.findings.filter((f) => f.outcome === 'MATCH');
    if (matched.length > 0 && analysis.parseStatus === 'OK') {
      alertId = randomUUID();
      await client.query(
        `INSERT INTO alerts (id, tenant_id, email_sample_id, priority, title, reason_codes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          alertId, actor.tenantId, sampleId, analysis.priority ?? 'LOW',
          alertTitleFor(analysis), JSON.stringify(matched.map((f) => f.ruleId)),
        ],
      );
      if (analysis.priority === 'HIGH' || analysis.priority === 'CRITICAL') {
        caseId = randomUUID();
        await client.query(
          `INSERT INTO cases (id, tenant_id, title, status, priority, linked_email_sample_id)
           VALUES ($1,$2,$3,'OPEN',$4,$5)`,
          [caseId, actor.tenantId, caseTitleFor(analysis), analysis.priority, sampleId],
        );
        await client.query(
          `INSERT INTO case_events (id, tenant_id, case_id, actor_user_id, action, text)
           VALUES ($1,$2,$3,$4,'CREATE',$5)`,
          [randomUUID(), actor.tenantId, caseId, actor.userId, `Case opened automatically from email analysis (score ${analysis.score}).`],
        );
        await client.query(`UPDATE alerts SET case_id=$2 WHERE id=$1`, [alertId, caseId]);
      }
    }

    await appendAuditEventWithConfig(client, config, {
      tenantId: actor.tenantId,
      aggregateType: 'email_sample',
      aggregateId: sampleId,
      aggregateVersion: 1,
      actorUserId: actor.userId,
      eventType: AuditEventTypes.EMAIL_SAMPLE_INGESTED,
      safeMetadata: {
        digest: analysis.digest,
        provenance: analysis.provenance,
        parseStatus: analysis.parseStatus,
        score: analysis.score,
        priority: analysis.priority,
        matchedRules: matched.map((f) => f.ruleId),
      },
    });
    if (alertId) {
      await insertOutboxEvent(client, {
        tenantId: actor.tenantId,
        eventType: OutboxEventTypes.ALERT_CREATED,
        redactedPayload: { alertId, sampleId, priority: analysis.priority, matchedRules: matched.map((f) => f.ruleId) },
      });
    }
    return { sampleId, replay: false, alertId };
  }
}

function subjectOf(analysis: EmailAnalysisResponse): string {
  const normalized = analysis.normalized as { subject?: string } | null;
  const subject = normalized?.subject;
  if (typeof subject === 'string' && subject.length > 0) {
    return subject.slice(0, 200);
  }
  return '(no subject)';
}

function alertTitleFor(analysis: EmailAnalysisResponse): string {
  const normalized = analysis.normalized as { fromDomain?: string } | null;
  const domain = normalized?.fromDomain ?? 'unknown sender';
  return `Suspicious indicators in message from ${domain}`;
}

function caseTitleFor(analysis: EmailAnalysisResponse): string {
  const normalized = analysis.normalized as { fromDomain?: string } | null;
  return `High-risk email indicators — ${normalized?.fromDomain ?? 'unknown sender'}`;
}

export async function getEmailSampleView(db: Db, tenantId: string, sampleId: string): Promise<unknown> {
  const result = await db.query<EmailSampleRow>(
    `SELECT * FROM email_samples WHERE id = $1 AND tenant_id = $2`,
    [sampleId, tenantId],
  );
  const sample = result.rows[0];
  if (!sample) throw err('NOT_FOUND_IN_TENANT', 'Email sample not found.');
  const findings = await db.query<{
    rule_id: string;
    rule_version: string;
    outcome: string;
    severity: string;
    provenance: string;
    explanation: string;
    evidence_field: string | null;
    masked_excerpt: string | null;
  }>(
    `SELECT rule_id, rule_version, outcome, severity, provenance, explanation, evidence_field, masked_excerpt
     FROM email_findings WHERE email_sample_id = $1 ORDER BY rule_id`,
    [sampleId],
  );
  const alert = await db.query<{ id: string; priority: string; disposition: string; case_id: string | null }>(
    `SELECT id, priority, disposition, case_id FROM alerts WHERE email_sample_id = $1 LIMIT 1`,
    [sampleId],
  );
  return {
    id: sample.id,
    digest: sample.source_digest,
    provenance: sample.provenance,
    parseStatus: sample.parse_status,
    ruleVersion: sample.rule_version,
    score: sample.score,
    priority: sample.priority,
    unknownCount: sample.unknown_count,
    subject: sample.subject_display,
    headers: sample.parsed_headers_json,
    normalized: sample.normalized_fields_json,
    findings: findings.rows.map((f) => ({
      ruleId: f.rule_id,
      version: f.rule_version,
      outcome: f.outcome,
      severity: f.severity,
      provenance: f.provenance,
      explanation: f.explanation,
      evidenceField: f.evidence_field ?? undefined,
      maskedExcerpt: f.masked_excerpt ?? undefined,
    })),
    alert: alert.rows[0] ?? null,
    createdAt: sample.created_at.toISOString(),
  };
}

export async function listEmailSamples(
  db: Db,
  tenantId: string,
  limit: number,
  cursor?: string,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = $1';
  if (cursor) {
    params.push(cursor);
    where += ` AND id > $${params.length}`;
  }
  params.push(Math.min(limit, 100));
  const result = await db.query<EmailSampleRow>(
    `SELECT * FROM email_samples WHERE ${where} ORDER BY created_at DESC, id LIMIT $${params.length}`,
    params,
  );
  const rows = result.rows;
  return {
    items: rows.map((s) => ({
      id: s.id,
      subject: s.subject_display,
      provenance: s.provenance,
      parseStatus: s.parse_status,
      score: s.score,
      priority: s.priority,
      unknownCount: s.unknown_count,
      createdAt: s.created_at.toISOString(),
    })),
    nextCursor: rows.length === Math.min(limit, 100) ? rows[rows.length - 1]!.id : null,
  };
}

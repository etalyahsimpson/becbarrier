'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, EmptyState, StatCard, formatDate } from '@/components/ui';

interface Finding {
  ruleId: string;
  version: string;
  outcome: 'MATCH' | 'NO_MATCH' | 'UNKNOWN';
  severity: string;
  provenance: string;
  explanation: string;
  evidenceField?: string;
  maskedExcerpt?: string;
}

interface SampleDetail {
  id: string;
  digest: string;
  provenance: string;
  parseStatus: string;
  ruleVersion: string;
  score: number;
  priority: string | null;
  unknownCount: number;
  subject: string;
  headers: Record<string, unknown>;
  normalized: {
    fromAddress?: { displayName?: string | null; email?: string | null; domain?: string | null } | null;
    replyTo?: { email?: string | null } | null;
    subject?: string | null;
    authStatus?: {
      spf: string;
      dkim: string;
      dmarc: string;
      authenticationResultsPresent: boolean;
      claimTrust: string;
    };
    bodyTextExcerpt?: string | null;
    attachmentNames?: string[];
  };
  findings: Finding[];
  alert: { id: string; priority: string; disposition: string; case_id: string | null } | null;
  createdAt: string;
}

const SEVERITY_TONES: Record<string, 'critical' | 'high' | 'medium' | 'low' | 'neutral'> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'neutral',
};

export default function EmailSampleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['email-sample', id],
    queryFn: () => api<SampleDetail>(`/email-samples/${id}`),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading sample…</p>;
  if (error || !data) return <EmptyState title="Sample not found" description="It may belong to another tenant." />;

  const from = data.normalized.fromAddress;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs uppercase tracking-wider text-slate-500">Email Risk Review</p>
        <h1 className="mt-1 max-w-3xl truncate text-2xl font-semibold tracking-tight text-navy-950">{data.subject}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {from?.displayName ? `${from.displayName} · ` : ''}
          <span className="font-mono">{from?.email ?? 'unparseable sender'}</span>
          {' — '}analyzed {formatDate(data.createdAt)}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Priority score" value={data.score} hint={data.priority ? `Priority ${data.priority}` : 'No rules fired'} tone={data.priority === 'CRITICAL' || data.priority === 'HIGH' ? 'denied' : 'info'} />
        <StatCard label="Provenance" value={<span className="text-lg">{data.provenance.replaceAll('_', ' ')}</span>} hint="Uploaded file — no trusted delivery telemetry" />
        <StatCard label="Parse status" value={<span className="text-lg">{data.parseStatus}</span>} hint="Bounded MIME parsing" />
        <StatCard label="Unknown outcomes" value={data.unknownCount} hint="Explicit uncertainty, not silent PASS" />
      </section>

      {data.alert && (
        <Card title="Linked alert & case">
          <p className="text-sm text-slate-600">
            <Badge tone={data.alert.priority === 'CRITICAL' ? 'critical' : 'high'}>{data.alert.priority} alert</Badge>{' '}
            {data.alert.case_id ? (
              <>
                escalated to{' '}
                <Link href={`/cases/${data.alert.case_id}`} className="font-medium text-info-500 hover:underline">
                  investigation case
                </Link>
                .
              </>
            ) : (
              <>— not escalated (below HIGH threshold).</>
            )}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Normalized sender & authentication truth">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">From</dt>
              <dd className="text-right font-mono text-xs">{from?.email ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Reply-To</dt>
              <dd className="text-right font-mono text-xs">{data.normalized.replyTo?.email ?? '(not set)'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">SPF</dt>
              <dd><Badge tone="neutral">{data.normalized.authStatus?.spf ?? 'UNKNOWN'}</Badge></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">DKIM</dt>
              <dd><Badge tone="neutral">{data.normalized.authStatus?.dkim ?? 'NOT_PRESENT'}</Badge></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">DMARC</dt>
              <dd><Badge tone="neutral">{data.normalized.authStatus?.dmarc ?? 'NOT_EVALUATED'}</Badge></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Auth-results claim</dt>
              <dd><Badge tone={data.normalized.authStatus?.claimTrust === 'TRUSTED' ? 'verified' : 'pending'}>
                {data.normalized.authStatus?.claimTrust ?? 'NONE'}
              </Badge></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Source digest (SHA-256)</dt>
              <dd className="text-right font-mono text-[10px] text-slate-500">{data.digest.slice(0, 32)}…</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            A raw upload can never present verified SPF/DKIM/DMARC — header values are treated as claims only.
          </p>
        </Card>

        <Card title={`Rule findings (${data.ruleVersion})`}>
          <ul className="space-y-3">
            {data.findings.map((finding) => (
              <li key={finding.ruleId} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-navy-950">{finding.ruleId}</span>
                  <Badge tone={finding.outcome === 'MATCH' ? (SEVERITY_TONES[finding.severity] ?? 'neutral') : 'neutral'}>
                    {finding.outcome}
                  </Badge>
                  {finding.outcome === 'MATCH' && <Badge tone="neutral">{finding.severity}</Badge>}
                  <span className="ml-auto text-[10px] text-slate-400">v{finding.version}</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">{finding.explanation}</p>
                {finding.maskedExcerpt && (
                  <p className="mt-2 rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600">
                    {finding.evidenceField ? `${finding.evidenceField}: ` : ''}
                    {finding.maskedExcerpt}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Safe body excerpt (redacted)">
        {data.normalized.bodyTextExcerpt ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-mono text-xs text-slate-700">
            {data.normalized.bodyTextExcerpt}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">
            No text excerpt available ({data.parseStatus}). Attachments are never extracted or executed.
            {(data.normalized.attachmentNames?.length ?? 0) > 0 && (
              <> Attachment names only: {data.normalized.attachmentNames!.join(', ')}.</>
            )}
          </p>
        )}
      </Card>
    </div>
  );
}

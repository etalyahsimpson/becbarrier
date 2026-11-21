'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, EmptyState, ErrorNote, LoadingRow, StatCard, formatDate } from '@/components/ui';
import { useSession } from '@/lib/session';

interface AuditRow {
  id: string; sequence: number; eventType: string; aggregateType: string; aggregateId: string;
  actorName: string | null; eventTime: string; metadata: Record<string, unknown>;
}

export default function AuditPage() {
  const { actor } = useSession();
  const [filter, setFilter] = useState('');
  const canView = actor?.role === 'AUDITOR' || actor?.role === 'TENANT_ADMIN';

  const events = useQuery({
    queryKey: ['audit-events', filter],
    queryFn: () => api<{ items: AuditRow[] }>(`/audit-events?limit=100${filter ? `&eventType=${encodeURIComponent(filter)}` : ''}`),
    enabled: canView,
  });
  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api<{ auditEvents: number; emailSamples: number }>('/reports/summary') });

  if (!canView) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Audit & Reporting</h1>
        <ErrorNote message="Audit history is restricted to auditors and tenant administrators." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Audit & Reporting</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Tenant-scoped, HMAC-chained audit history. Events are append-only for application roles; the integrity
          verifier (`npm run test:audit-verify`) recomputes the whole chain and detects edits or gaps.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Chained audit events" value={summary.data?.auditEvents ?? '—'} />
        <StatCard label="Email samples" value={summary.data?.emailSamples ?? '—'} />
        <StatCard label="Chain integrity" value={<span className="text-lg">HMAC-SHA-256</span>} hint="Keyed per tenant sequence" />
        <StatCard label="Export" value={<span className="text-lg">CSV</span>} hint="Counts only — no PII, no bank data" />
      </section>

      <Card
        title="Event history (redacted)"
        action={
          <div className="flex gap-2">
            <input className="rounded-lg border border-slate-300 px-2 py-1 text-xs" placeholder="Filter event type…" value={filter}
              onChange={(e) => setFilter(e.target.value.toUpperCase())} aria-label="Filter by event type" />
            <a href="/api/v1/reports/summary?format=csv" className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">Export CSV</a>
          </div>
        }
      >
        {events.isLoading ? (
          <DataTable headers={['#', 'Event', 'Aggregate', 'Actor', 'Time', 'Metadata']}><LoadingRow colSpan={6} /></DataTable>
        ) : (events.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No audit events" />
        ) : (
          <DataTable headers={['#', 'Event', 'Aggregate', 'Actor', 'Time', 'Metadata']}>
            {events.data!.items.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 tabular-nums text-slate-400">{e.sequence}</td>
                <td className="px-3 py-2"><Badge tone="neutral">{e.eventType}</Badge></td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{e.aggregateType}:{e.aggregateId.slice(0, 8)}</td>
                <td className="px-3 py-2">{e.actorName ?? 'system'}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(e.eventTime)}</td>
                <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-[11px] text-slate-500">{JSON.stringify(e.metadata)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}

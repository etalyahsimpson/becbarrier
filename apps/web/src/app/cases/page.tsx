'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, EmptyState, LoadingRow, formatDate } from '@/components/ui';

interface AlertRow { id: string; priority: string; title: string; reasonCodes: string[]; disposition: string; caseId: string | null; createdAt: string }
interface CaseRow { id: string; title: string; status: string; priority: string | null; updatedAt: string }

export default function CasesPage() {
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api<{ items: AlertRow[] }>('/alerts?limit=50') });
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api<{ items: CaseRow[] }>('/cases?limit=50') });

  type Tone = 'critical' | 'high' | 'medium' | 'low';
  const tone = (p: string): Tone => (p === 'CRITICAL' ? 'critical' : p === 'HIGH' ? 'high' : p === 'MEDIUM' ? 'medium' : 'low');

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Investigation Workspace</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Reason-coded alerts and cases link email evidence to supplier bank changes. Analyst notes are redacted;
          exports stay tenant-scoped.
        </p>
      </section>

      <Card title="Open alerts">
        {alerts.isLoading ? (
          <DataTable headers={['Priority', 'Title', 'Reason codes', 'Disposition', 'Raised']}><LoadingRow colSpan={5} /></DataTable>
        ) : (alerts.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No alerts" description="Analyze an email to raise reason-coded alerts." />
        ) : (
          <DataTable headers={['Priority', 'Title', 'Reason codes', 'Disposition', 'Raised']}>
            {alerts.data!.items.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-3 py-2"><Badge tone={tone(a.priority)}>{a.priority}</Badge></td>
                <td className="px-3 py-2">{a.title}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{a.reasonCodes.join(', ')}</td>
                <td className="px-3 py-2">{a.disposition}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(a.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card title="Cases">
        {cases.isLoading ? (
          <DataTable headers={['Case', 'Status', 'Priority', 'Updated']}><LoadingRow colSpan={4} /></DataTable>
        ) : (cases.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No cases" description="HIGH/CRITICAL alerts open cases automatically." />
        ) : (
          <DataTable headers={['Case', 'Status', 'Priority', 'Updated']}>
            {cases.data!.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-3 py-2"><Link href={`/cases/${c.id}`} className="font-medium text-info-500 hover:underline">{c.title}</Link></td>
                <td className="px-3 py-2"><Badge tone={c.status === 'CLOSED' ? 'verified' : 'info'}>{c.status}</Badge></td>
                <td className="px-3 py-2">{c.priority ? <Badge tone={tone(c.priority)}>{c.priority}</Badge> : '—'}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(c.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, DataTable, EmptyState, StatCard, StateBadge, formatDate } from '@/components/ui';

interface Summary {
  changes: Record<string, number>;
  callbacksPending: number;
  approvalsPending: number;
  cases: Record<string, number>;
  alerts: { open: number; byPriority: Record<string, number> };
  emailSamples: number;
  auditEvents: number;
  recentChanges: Array<{ id: string; supplierName: string; state: string; revision: number; updatedAt: string }>;
  generatedAt: string;
}

export default function SecurityOverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/reports/summary'),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading operational picture…</p>;
  if (error || !data) return <p className="text-sm text-denied">Unable to load summary. Is the API running?</p>;

  const openCases = Object.entries(data.cases).filter(([status]) => status !== 'CLOSED').reduce((acc, [, v]) => acc + v, 0);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Security Overview</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Every supplier bank-account change enters <strong>ON_HOLD</strong> regardless of how legitimate the
          request looks. Release requires an independent callback to a previously approved contact plus two
          distinct approvals — email analysis results are advisory and can never approve a payment.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Key operational counters">
        <StatCard label="Bank changes on hold" value={data.changes.ON_HOLD ?? 0} tone="pending" hint="Mandatory hold pending callback" />
        <StatCard label="Callbacks pending" value={data.callbacksPending} tone="pending" hint="Awaiting independent verification" />
        <StatCard label="Approvals pending" value={data.approvalsPending} tone="info" hint="Verified, awaiting dual approval" />
        <StatCard label="Open cases" value={openCases} tone="info" hint={`${data.alerts.open} open alerts`} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Alerts by priority (open)" className="lg:col-span-1">
          <ul className="space-y-2 text-sm">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => (
              <li key={priority} className="flex items-center justify-between">
                <span className="text-slate-600">{priority.charAt(0) + priority.slice(1).toLowerCase()}</span>
                <span className="font-semibold tabular-nums text-navy-950">{data.alerts.byPriority[priority] ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Reason-coded indicators from email analysis (rule set <span className="font-mono">bec-rules-v1</span>).
          </p>
        </Card>

        <Card title="Workflow distribution" className="lg:col-span-2">
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {Object.entries(data.changes).map(([state, count]) => (
              <li key={state} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <StateBadge state={state} />
                <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Counts come from tenant-scoped database queries only — {data.emailSamples} email samples analyzed,
            {' '}{data.auditEvents} audit events chained.
          </p>
        </Card>
      </section>

      <Card
        title="Recent bank-change activity"
        action={
          <Link href="/bank-changes" className="text-xs font-medium text-info-500 hover:underline">
            Open control center →
          </Link>
        }
      >
        {data.recentChanges.length === 0 ? (
          <EmptyState
            title="No bank-change requests yet"
            description="Submit a supplier bank change to see the governed workflow: HOLD → callback → dual approval → release for ERP update."
          />
        ) : (
          <DataTable headers={['Supplier', 'State', 'Revision', 'Updated']}>
            {data.recentChanges.map((change) => (
              <tr key={change.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/bank-changes/${change.id}`} className="font-medium text-info-500 hover:underline">
                    {change.supplierName}
                  </Link>
                </td>
                <td className="px-3 py-2"><StateBadge state={change.state} /></td>
                <td className="px-3 py-2 tabular-nums">rev {change.revision}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(change.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card title="Where to begin">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>
            <Link href="/emails" className="font-medium text-info-500 hover:underline">Review suspicious email</Link> —
            upload a synthetic .eml to see the BEC-01…07 indicators with provenance and evidence.
          </li>
          <li>
            <Link href="/bank-changes" className="font-medium text-info-500 hover:underline">Submit a bank change</Link> —
            any new instruction is held immediately (BEC-08 workflow rule).
          </li>
          <li>
            <Link href="/queues" className="font-medium text-info-500 hover:underline">Work the queues</Link> —
            verify callbacks against approved contacts and give the two independent approvals.
          </li>
        </ol>
      </Card>
    </div>
  );
}

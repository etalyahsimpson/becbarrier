'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, DataTable, EmptyState, LoadingRow, StateBadge, formatDate } from '@/components/ui';
import { useSession, ROLE_LABELS } from '@/lib/session';

interface ChangeRow { id: string; supplierName: string; state: string; revision: number; updatedAt: string }

export default function QueuesPage() {
  const { actor } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ['bank-changes'],
    queryFn: () => api<{ items: ChangeRow[] }>('/bank-changes?limit=100'),
  });
  const all = data?.items ?? [];
  const awaitingCallback = all.filter((c) => c.state === 'ON_HOLD');
  const awaitingApproval = all.filter((c) => c.state === 'CALLBACK_VERIFIED' || c.state === 'APPROVAL_1');
  const releasable = all.filter((c) => c.state === 'APPROVAL_2');

  const queue = (items: ChangeRow[], title: string, note: string) => (
    <Card title={`${title} (${items.length})`}>
      {isLoading ? (
        <DataTable headers={['Supplier', 'State', 'Updated']}><LoadingRow colSpan={3} /></DataTable>
      ) : items.length === 0 ? (
        <EmptyState title="Queue empty" description={note} />
      ) : (
        <DataTable headers={['Supplier', 'State', 'Updated']}>
          {items.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <td className="px-3 py-2"><Link href={`/bank-changes/${c.id}`} className="font-medium text-info-500 hover:underline">{c.supplierName}</Link></td>
              <td className="px-3 py-2"><StateBadge state={c.state} /></td>
              <td className="px-3 py-2 text-slate-500">{formatDate(c.updatedAt)}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Verification & Approval Queues</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Actions are role-restricted server-side. You are signed in as{' '}
          <strong>{ROLE_LABELS[actor?.role ?? ''] ?? actor?.role}</strong>
          {actor?.role === 'SUPPLIER_VERIFIER' && ' — you can attest independent callbacks for others’ requests.'}
          {actor?.role === 'FINANCE_APPROVER' && ' — you can approve or reject verified requests; never your own.'}
          {actor?.role === 'AUDITOR' && ' — read-only: approval actions are not available to auditors.'}
        </p>
      </section>
      {queue(awaitingCallback, 'Awaiting independent callback', 'Nothing on hold right now.')}
      {queue(awaitingApproval, 'Awaiting approvals', 'Nothing verified-and-pending right now.')}
      {queue(releasable, 'Ready to release (two distinct approvals recorded)', 'Nothing awaiting release.')}
    </div>
  );
}

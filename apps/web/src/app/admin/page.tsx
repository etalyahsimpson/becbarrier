'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, EmptyState, LoadingRow, formatDate } from '@/components/ui';
import { useSession, ROLE_LABELS } from '@/lib/session';

interface SupplierDetail {
  id: string; canonicalName: string; approvedDomains: Array<{ domain: string }>;
  contacts: Array<{ id: string; label: string; maskedValue: string; establishedAt: string; provenance: string }>;
}

export default function AdminPage() {
  const { actor } = useSession();
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<{ items: Array<{ id: string; canonicalName: string }> }>('/suppliers') });
  const firstSupplier = suppliers.data?.items[0];
  const detail = useQuery({
    queryKey: ['supplier', firstSupplier?.id],
    queryFn: () => api<SupplierDetail>(`/suppliers/${firstSupplier!.id}`),
    enabled: Boolean(firstSupplier),
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Administration</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Demo role/tenant configuration indicators, approved-contact policy and connector status. Secrets are never
          displayed. Tenant administrators manage memberships and contact policy under audit — they cannot bypass
          callbacks, impersonate approvers or waive separation of duties.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Environment"><dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Mode</dt><dd><Badge tone="info">Local demo (development)</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Identity</dt><dd>Demo adapter (dev/test only)</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">OIDC</dt><dd>Not configured — production fails closed</dd></div>
        </dl></Card>
        <Card title="Connector status"><dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Email intelligence</dt><dd><Badge tone="verified">internal</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">ERP adapter</dt><dd><Badge tone="pending">contract demo stub</Badge></dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Mailbox connectors</dt><dd><Badge tone="neutral">future integration</Badge></dd></div>
        </dl></Card>
        <Card title="Session"><dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Signed in as</dt><dd className="font-medium">{actor?.userName}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Role</dt><dd>{ROLE_LABELS[actor?.role ?? ''] ?? actor?.role}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Tenant</dt><dd>{actor?.tenantName}</dd></div>
        </dl></Card>
      </section>

      <Card title="Approved-contact policy (first supplier)">
        {detail.isLoading ? (
          <DataTable headers={['Contact', 'Value', 'Established', 'Provenance']}><LoadingRow colSpan={4} /></DataTable>
        ) : !detail.data ? (
          <EmptyState title="No supplier data" />
        ) : (
          <DataTable headers={['Contact', 'Value', 'Established', 'Provenance']}>
            {detail.data.contacts.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{c.label}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.maskedValue}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(c.establishedAt)}</td>
                <td className="px-3 py-2"><Badge tone="neutral">{c.provenance}</Badge></td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Contact approvals by administrators are audited (CONTACT_APPROVED) and must pre-date any change request that
          cites them (invariant 3).
        </p>
      </Card>
    </div>
  );
}

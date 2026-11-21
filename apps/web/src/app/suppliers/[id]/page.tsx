'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, EmptyState, formatDate } from '@/components/ui';

interface SupplierDetail {
  id: string;
  canonicalName: string;
  status: string;
  approvedDomains: Array<{ domain: string; aliasOf: string | null; approvedAt: string }>;
  approvedDomainsVersion: number;
  createdAt: string;
  contacts: Array<{
    id: string;
    channel: string;
    maskedValue: string;
    label: string;
    establishedAt: string;
    version: number;
    active: boolean;
    provenance: string;
  }>;
  paymentAccounts: Array<{
    id: string;
    maskedSuffix: string;
    beneficiaryName: string;
    currency: string;
    approvedVersion: number;
    activeFrom: string;
    activeTo: string | null;
  }>;
  recentChanges: Array<{ id: string; state: string; revision: number; createdAt: string }>;
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api<SupplierDetail>(`/suppliers/${id}`),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading supplier…</p>;
  if (error || !data) return <EmptyState title="Supplier not found" />;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs uppercase tracking-wider text-slate-500">Supplier Directory</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-950">{data.canonicalName}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Established {formatDate(data.createdAt)} · directory version {data.approvedDomainsVersion} · {data.status}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Approved domains & aliases">
          <ul className="space-y-2 text-sm">
            {data.approvedDomains.map((entry) => (
              <li key={entry.domain} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-mono text-xs">{entry.domain}</span>
                <span className="flex items-center gap-2">
                  {entry.aliasOf ? <Badge tone="info">alias of {entry.aliasOf}</Badge> : <Badge tone="verified">primary</Badge>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            The email analyzer receives exactly this set from the tenant-checked database — never a client-supplied list.
          </p>
        </Card>

        <Card title="Approved callback contacts (masked)">
          <DataTable headers={['Channel', 'Contact', 'Established', 'State']}>
            {data.contacts.map((contact) => (
              <tr key={contact.id}>
                <td className="px-3 py-2">{contact.channel === 'PHONE' ? 'Phone' : 'Email'}</td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs">{contact.maskedValue}</span>
                  <span className="block text-xs text-slate-500">{contact.label}</span>
                </td>
                <td className="px-3 py-2 text-slate-500">{formatDate(contact.establishedAt)}</td>
                <td className="px-3 py-2">
                  <Badge tone={contact.active ? 'verified' : 'neutral'}>{contact.active ? 'active' : 'inactive'}</Badge>
                </td>
              </tr>
            ))}
          </DataTable>
          <p className="mt-3 text-xs text-slate-500">
            Raw contact values are AES-256-GCM encrypted; the UI receives masked values only.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Payment accounts (masked references)">
          <DataTable headers={['Account', 'Beneficiary', 'Active']}>
            {data.paymentAccounts.map((account) => (
              <tr key={account.id}>
                <td className="px-3 py-2 font-mono text-xs">{account.maskedSuffix} {account.currency}</td>
                <td className="px-3 py-2">{account.beneficiaryName}</td>
                <td className="px-3 py-2">
                  <Badge tone={account.activeTo ? 'neutral' : 'verified'}>
                    {account.activeTo ? `until ${formatDate(account.activeTo)}` : 'current'}
                  </Badge>
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>

        <Card title="Recent bank-change requests">
          {data.recentChanges.length === 0 ? (
            <p className="text-sm text-slate-500">No change requests for this supplier yet.</p>
          ) : (
            <DataTable headers={['Request', 'State', 'Created']}>
              {data.recentChanges.map((change) => (
                <tr key={change.id}>
                  <td className="px-3 py-2">
                    <Link href={`/bank-changes/${change.id}`} className="text-info-500 hover:underline">
                      rev {change.revision}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><Badge tone="info">{change.state.replaceAll('_', ' ')}</Badge></td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(change.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </div>
  );
}

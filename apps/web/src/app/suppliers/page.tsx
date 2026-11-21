'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, EmptyState, LoadingRow } from '@/components/ui';

interface SupplierRow {
  id: string;
  canonicalName: string;
  status: string;
  approvedDomains: string[];
  contactCount: number;
  maskedSuffix: string | null;
  currency: string | null;
  openChanges: number;
}

export default function SupplierDirectoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api<{ items: SupplierRow[] }>('/suppliers'),
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Supplier Directory</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          The approved-contact directory is the authority for callbacks: every verification must use a contact that
          was established <strong>before</strong> the change request. Contact values are encrypted at rest and only
          ever displayed masked; bank references show the last four characters only.
        </p>
      </section>

      <Card title="Registered suppliers">
        {isLoading ? (
          <DataTable headers={['Supplier', 'Approved domains', 'Approved contacts', 'Active account', 'Open changes']}>
            <LoadingRow colSpan={5} />
          </DataTable>
        ) : (data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No suppliers" description="Synthetic suppliers are created by the seed." />
        ) : (
          <DataTable headers={['Supplier', 'Approved domains', 'Approved contacts', 'Active account', 'Open changes']}>
            {data!.items.map((supplier) => (
              <tr key={supplier.id} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/suppliers/${supplier.id}`} className="font-medium text-info-500 hover:underline">
                    {supplier.canonicalName}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400">{supplier.status}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {supplier.approvedDomains.map((domain) => (
                      <Badge key={domain} tone="verified">{domain}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums">{supplier.contactCount}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {supplier.maskedSuffix ? `${supplier.maskedSuffix} ${supplier.currency ?? ''}` : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums">{supplier.openChanges}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}

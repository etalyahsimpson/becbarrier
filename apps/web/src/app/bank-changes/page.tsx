'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, apiIdempotent, newIdempotencyKey } from '@/lib/api';
import { Card, DataTable, EmptyState, ErrorNote, LoadingRow, StateBadge, formatDate } from '@/components/ui';
import { useSession } from '@/lib/session';

interface ChangeRow { id: string; supplierName: string; state: string; revision: number; currency: string; proposedMasked: { accountSuffix: string }; updatedAt: string }

const createSchema = z.object({
  supplierId: z.string().uuid('Select a supplier'),
  accountIdentifier: z.string().min(6).max(42),
  beneficiaryName: z.string().min(2).max(140),
  bankName: z.string().min(2).max(140),
  currency: z.string().length(3),
  reason: z.string().min(4).max(500),
});
type CreateForm = z.infer<typeof createSchema>;

export default function BankChangeControlPage() {
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<string | null>(null);
  const canCreate = actor?.role === 'FINANCE_INITIATOR' || actor?.role === 'TENANT_ADMIN';

  const changes = useQuery({ queryKey: ['bank-changes'], queryFn: () => api<{ items: ChangeRow[] }>('/bank-changes?limit=50') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<{ items: Array<{ id: string; canonicalName: string }> }>('/suppliers') });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { supplierId: '', accountIdentifier: '', beneficiaryName: '', bankName: '', currency: 'GBP', reason: '' },
  });

  const submit = useMutation({
    mutationFn: (values: CreateForm) =>
      apiIdempotent<{ id: string }>(`/suppliers/${values.supplierId}/bank-changes`, {
        proposed: {
          accountIdentifier: values.accountIdentifier,
          beneficiaryName: values.beneficiaryName,
          bankName: values.bankName,
          currency: values.currency.toUpperCase(),
        },
        reason: values.reason,
      }, newIdempotencyKey()),
    onSuccess: (view: { id: string }) => {
      setCreated(view.id);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ['bank-changes'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Bank-Change Control Center</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Every new supplier bank instruction enters <strong>ON_HOLD</strong> (workflow rule BEC-08) — independent of
          email risk. Release requires an independent callback to a pre-approved contact and two distinct approvals
          bound to the exact immutable revision. No funds move here: release produces an ERP update instruction only.
        </p>
      </section>

      {canCreate && (
        <Card title="Submit a bank-change request">
          <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={form.handleSubmit((v) => submit.mutate(v))}>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Supplier</span>
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register('supplierId')} aria-label="Supplier">
                <option value="">Select supplier…</option>
                {suppliers.data?.items.map((s) => <option key={s.id} value={s.id}>{s.canonicalName}</option>)}
              </select>
              {form.formState.errors.supplierId && <span className="mt-1 block text-xs text-denied">{form.formState.errors.supplierId.message}</span>}
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">New account identifier</span>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="GB00SYNT0000…" {...form.register('accountIdentifier')} />
              {form.formState.errors.accountIdentifier && <span className="mt-1 block text-xs text-denied">{form.formState.errors.accountIdentifier.message}</span>}
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Beneficiary name</span>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register('beneficiaryName')} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Bank name</span>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2" {...form.register('bankName')} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Currency</span>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase" maxLength={3} {...form.register('currency')} />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium text-slate-700">Reason / context</span>
              <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2" rows={2} placeholder="Supplier emailed updated remittance details…" {...form.register('reason')} />
            </label>
            <div className="md:col-span-2">
              <button type="submit" disabled={submit.isPending} className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800 disabled:opacity-60">
                {submit.isPending ? 'Submitting…' : 'Submit — enters mandatory hold'}
              </button>
              {submit.isError && <div className="mt-3"><ErrorNote message={submit.error instanceof Error ? submit.error.message : 'Submission failed.'} /></div>}
              {created && (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  Request created and held. <Link className="font-medium underline" href={`/bank-changes/${created}`}>Open it →</Link>
                </p>
              )}
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Values are encrypted (AES-256-GCM) before persistence; only masked suffixes ever leave the API.
          </p>
        </Card>
      )}

      <Card title="All bank-change requests">
        {changes.isLoading ? (
          <DataTable headers={['Supplier', 'State', 'Revision', 'Proposed', 'Updated']}><LoadingRow colSpan={5} /></DataTable>
        ) : (changes.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No bank-change requests" description="Submit a request to start the governed workflow." />
        ) : (
          <DataTable headers={['Supplier', 'State', 'Revision', 'Proposed', 'Updated']}>
            {changes.data!.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-3 py-2"><Link href={`/bank-changes/${c.id}`} className="font-medium text-info-500 hover:underline">{c.supplierName}</Link></td>
                <td className="px-3 py-2"><StateBadge state={c.state} /></td>
                <td className="px-3 py-2 tabular-nums">rev {c.revision}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.proposedMasked.accountSuffix} {c.currency}</td>
                <td className="px-3 py-2 text-slate-500">{formatDate(c.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </div>
  );
}

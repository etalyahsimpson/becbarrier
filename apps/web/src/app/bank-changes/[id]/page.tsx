'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiIdempotent, newIdempotencyKey } from '@/lib/api';
import { Badge, Card, EmptyState, ErrorNote, StateBadge, formatDate } from '@/components/ui';
import { useSession } from '@/lib/session';

interface ChangeDetail {
  id: string; supplierId: string; supplierName: string; state: string; revision: number; currency: string;
  proposedMasked: { accountSuffix: string; beneficiaryName: string; bankName: string };
  previousMasked: { accountSuffix: string; beneficiaryName: string; bankName: string } | null;
  callback: { result: string; verifiedByUserName: string; verifiedAt: string; expiresAt: string; contactRef: string; revision: number } | null;
  approvals: Array<{ sequence: number; decision: string; approverUserName: string; decidedAt: string }>;
  initiatorUserName: string; callbackExpiresAt: string | null;
  revisions: Array<{ revision: number; beneficiaryName: string; bankName: string; accountSuffix: string; currency: string; reason: string; createdAt: string }>;
  auditTimeline: Array<{ eventType: string; eventTime: string; metadata: Record<string, unknown> }>;
}

export default function BankChangeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [evidenceRef, setEvidenceRef] = useState('call-log-entry');

  const { data, isLoading } = useQuery({
    queryKey: ['bank-change', id],
    queryFn: () => api<ChangeDetail>(`/bank-changes/${id}`),
  });
  const contacts = useQuery({
    queryKey: ['supplier-contacts', data?.supplierId],
    queryFn: () => api<{ contacts: Array<{ id: string; label: string; maskedValue: string; channel: string; establishedAt: string }> }>(`/suppliers/${data!.supplierId}`),
    enabled: Boolean(data?.supplierId),
  });

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      apiIdempotent(`/bank-changes/${id}/${path}`, body ?? {}, newIdempotencyKey()),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['bank-change', id] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
    onError: (e) => setError(e instanceof Error ? `${(e as { code?: string }).code ?? 'ERROR'}: ${e.message}` : 'Action failed.'),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading request…</p>;
  if (!data) return <EmptyState title="Request not found" description="It may belong to another tenant." />;

  const role = actor?.role ?? '';
  const canVerify = role === 'SUPPLIER_VERIFIER' && data.state === 'ON_HOLD' && actor && data.initiatorUserName !== actor.userName;
  const canApprove = role === 'FINANCE_APPROVER';
  const canRelease = (role === 'FINANCE_APPROVER' || role === 'TENANT_ADMIN') && data.state === 'APPROVAL_2';
  const alreadyApproved = data.approvals.some((a) => a.approverUserName === actor?.userName);
  const isInitiator = data.initiatorUserName === actor?.userName;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Bank-Change Control</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-950">{data.supplierName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Requested by {data.initiatorUserName} · revision {data.revision} · created from immutable revision history
          </p>
        </div>
        <StateBadge state={data.state} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Masked before / after">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Current (approved) account</dt>
              <dd className="font-mono text-xs">{data.previousMasked ? `${data.previousMasked.accountSuffix} · ${data.previousMasked.beneficiaryName}` : '— (none on file)'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Proposed account</dt>
              <dd className="font-mono text-xs">{data.proposedMasked.accountSuffix}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Proposed beneficiary</dt><dd>{data.proposedMasked.beneficiaryName}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Bank / currency</dt><dd>{data.proposedMasked.bankName} · {data.currency}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Full values are AES-256-GCM encrypted; comparisons use keyed HMAC fingerprints.</p>
        </Card>

        <Card title="Independent callback verification">
          {data.callback ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Outcome</dt><dd><Badge tone="verified">{data.callback.result}</Badge></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Verified by</dt><dd>{data.callback.verifiedByUserName}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Approved contact</dt><dd>{data.callback.contactRef}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Attested</dt><dd>{formatDate(data.callback.verifiedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Expires</dt><dd>{formatDate(data.callback.expiresAt)}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              No confirmed callback for revision {data.revision}. Verification must use a directory contact established
              before this request — a phone number supplied inside the requesting email is never acceptable.
            </p>
          )}
          {canVerify && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Approved contact">
                {contacts.data?.contacts.filter((c) => new Date(c.establishedAt).getTime() < Date.now()).map((c) => (
                  <option key={c.id} value={c.id}>{c.label} ({c.maskedValue})</option>
                ))}
              </select>
              <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} aria-label="Evidence reference" placeholder="evidence reference (redacted)" />
              <div className="flex gap-2">
                <button
                  className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-500"
                  onClick={() => {
                    const select = document.querySelector('select[aria-label="Approved contact"]') as HTMLSelectElement;
                    action.mutate({ path: 'verify', body: { revision: data.revision, approvedContactId: select.value, result: 'CONFIRMED', method: 'APPROVED_DIRECTORY_CONTACT', evidenceRef } });
                  }}
                >
                  Attest CONFIRMED
                </button>
                <button
                  className="rounded-lg bg-denied px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  onClick={() => {
                    const select = document.querySelector('select[aria-label="Approved contact"]') as HTMLSelectElement;
                    action.mutate({ path: 'verify', body: { revision: data.revision, approvedContactId: select.value, result: 'DENIED', method: 'APPROVED_DIRECTORY_CONTACT', evidenceRef } });
                  }}
                >
                  Attest DENIED
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title={`Dual approval (revision ${data.revision})`}>
        {data.approvals.length === 0 ? (
          <p className="text-sm text-slate-500">No approvals yet for this exact revision.</p>
        ) : (
          <ol className="space-y-2">
            {data.approvals.map((a) => (
              <li key={a.sequence} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span><Badge tone="verified">Approval {a.sequence}</Badge> <span className="ml-2 font-medium">{a.approverUserName}</span></span>
                <span className="text-xs text-slate-500">{formatDate(a.decidedAt)}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {canApprove && !alreadyApproved && !isInitiator && data.callback && (
            <button className="rounded-lg bg-navy-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800"
              onClick={() => action.mutate({ path: 'decisions', body: { revision: data.revision, decision: 'APPROVE' } })}>
              Approve ({data.approvals.length === 0 ? '1st' : '2nd'} of 2)
            </button>
          )}
          {canApprove && !isInitiator && (
            <button className="rounded-lg border border-denied px-3 py-1.5 text-xs font-medium text-denied hover:bg-rose-50"
              onClick={() => action.mutate({ path: 'decisions', body: { revision: data.revision, decision: 'REJECT' } })}>
              Reject
            </button>
          )}
          {canRelease && (
            <button className="rounded-lg bg-verified px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              onClick={() => action.mutate({ path: 'release', body: { revision: data.revision } })}>
              Release for ERP update instruction
            </button>
          )}
          {isInitiator && ['ON_HOLD', 'CALLBACK_VERIFIED', 'APPROVAL_1', 'APPROVAL_2'].includes(data.state) && (
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              onClick={() => action.mutate({ path: 'cancel' })}>
              Cancel request
            </button>
          )}
        </div>
        {alreadyApproved && <p className="mt-2 text-xs text-slate-500">You already approved this revision — separation of duties forbids a second approval by the same identity.</p>}
        {isInitiator && <p className="mt-2 text-xs text-slate-500">As the initiator you cannot approve or verify your own request (invariant 4).</p>}
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Immutable revision history">
          <ol className="space-y-2">
            {data.revisions.map((r) => (
              <li key={r.revision} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Revision {r.revision}</span>
                  <span className="font-mono text-xs">{r.accountSuffix} {r.currency}</span>
                </div>
                <p className="text-xs text-slate-500">{r.beneficiaryName} · {r.bankName} · {formatDate(r.createdAt)}</p>
                <p className="mt-1 text-xs text-slate-600">{r.reason}</p>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Audit timeline (redacted)">
          <ol className="space-y-2">
            {data.auditTimeline.map((e, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden />
                <span>
                  <span className="font-mono text-xs font-semibold">{e.eventType}</span>
                  <span className="block text-xs text-slate-500">{formatDate(e.eventTime)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

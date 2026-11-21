'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiIdempotent, newIdempotencyKey } from '@/lib/api';
import { Badge, Card, EmptyState, ErrorNote, formatDate } from '@/components/ui';
import { useSession } from '@/lib/session';

interface CaseDetail {
  id: string; title: string; status: string; priority: string | null; assigneeName: string | null;
  linkedChangeId: string | null; version: number;
  events: Array<{ id: string; action: string; text: string; actorName: string | null; createdAt: string }>;
  alerts: Array<{ id: string; priority: string; title: string; disposition: string }>;
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { actor } = useSession();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canWork = actor?.role === 'SECURITY_ANALYST' || actor?.role === 'TENANT_ADMIN';

  const { data, isLoading } = useQuery({ queryKey: ['case', id], queryFn: () => api<CaseDetail>(`/cases/${id}`) });
  const append = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiIdempotent(`/cases/${id}/events`, body, newIdempotencyKey()),
    onSuccess: () => { setNote(''); setError(null); void queryClient.invalidateQueries({ queryKey: ['case', id] }); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not append event.'),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading case…</p>;
  if (!data) return <EmptyState title="Case not found" />;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Investigation case (version {data.version})</p>
          <h1 className="mt-1 max-w-3xl text-2xl font-semibold tracking-tight text-navy-950">{data.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {data.assigneeName ? `Assigned to ${data.assigneeName}` : 'Unassigned'} · {data.alerts.length} linked alert(s)
            {data.linkedChangeId && <> · linked bank change <span className="font-mono text-xs">{data.linkedChangeId.slice(0, 8)}</span></>}
          </p>
        </div>
        <Badge tone={data.status === 'CLOSED' ? 'verified' : 'info'}>{data.status}</Badge>
      </section>

      <Card title="Event timeline">
        <ol className="space-y-3">
          {data.events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 text-sm">
              <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden />
              <span>
                <span className="font-mono text-xs font-semibold">{e.action}</span> — {e.text}
                <span className="block text-xs text-slate-500">{e.actorName ?? 'system'} · {formatDate(e.createdAt)}</span>
              </span>
            </li>
          ))}
        </ol>
        {canWork && (
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={2} value={note}
              onChange={(e) => setNote(e.target.value)} placeholder="Redacted analyst note (no bank details, no credentials)…" aria-label="Case note" />
            <div className="flex flex-wrap gap-2">
              <button disabled={!note.trim()} className="rounded-lg bg-navy-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
                onClick={() => append.mutate({ action: 'COMMENT', text: note, expectedVersion: data.version })}>Add comment</button>
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                onClick={() => append.mutate({ action: 'DISPOSITION', text: 'IN_PROGRESS', expectedVersion: data.version })}>Mark in progress</button>
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                onClick={() => append.mutate({ action: 'DISPOSITION', text: 'ESCALATED', expectedVersion: data.version })}>Escalate</button>
              <button className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                onClick={() => append.mutate({ action: 'DISPOSITION', text: 'CLOSED', expectedVersion: data.version })}>Close case</button>
            </div>
            {error && <ErrorNote message={error} />}
            <p className="text-xs text-slate-500">Every event appends with a version precondition — concurrent edits return 409, never silently overwrite.</p>
          </div>
        )}
      </Card>
    </div>
  );
}

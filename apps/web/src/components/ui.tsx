'use client';

import type { ReactNode } from 'react';

/** Shared UI primitives for the BECBarrier workbench. */

export function Card({ title, action, children, className = '' }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold tracking-wide text-navy-900">{title}</h2>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, tone = 'neutral', hint }: {
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'pending' | 'verified' | 'denied' | 'info';
  hint?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'text-navy-950',
    pending: 'text-amber-500',
    verified: 'text-emerald-500',
    denied: 'text-denied',
    info: 'text-info-500',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

type BadgeTone = 'neutral' | 'info' | 'pending' | 'verified' | 'denied' | 'critical' | 'high' | 'medium' | 'low';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-info-500 ring-sky-200',
  pending: 'bg-amber-50 text-amber-600 ring-amber-200',
  verified: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  denied: 'bg-rose-50 text-denied ring-rose-200',
  critical: 'bg-rose-50 text-denied ring-rose-300',
  high: 'bg-orange-50 text-orange-600 ring-orange-200',
  medium: 'bg-amber-50 text-amber-600 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

const STATE_META: Record<string, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Draft' },
  SUBMITTED: { tone: 'info', label: 'Submitted' },
  ON_HOLD: { tone: 'pending', label: 'On hold' },
  CALLBACK_VERIFIED: { tone: 'info', label: 'Callback verified' },
  APPROVAL_1: { tone: 'info', label: 'Approval 1 of 2' },
  APPROVAL_2: { tone: 'verified', label: 'Approval 2 of 2' },
  RELEASED_FOR_ERP_UPDATE: { tone: 'verified', label: 'Released for ERP update' },
  ERP_APPLIED: { tone: 'verified', label: 'ERP applied' },
  REJECTED: { tone: 'denied', label: 'Rejected' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  EXPIRED: { tone: 'denied', label: 'Expired' },
};

/** Status is never encoded only in color: every state badge carries a label. */
export function StateBadge({ state }: { state: string }) {
  const meta = STATE_META[state] ?? { tone: 'neutral' as BadgeTone, label: state.replaceAll('_', ' ') };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-navy-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function DataTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
            {headers.map((header) => (
              <th key={header} scope="col" className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-sm text-slate-400">
        Loading…
      </td>
    </tr>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-denied ring-1 ring-inset ring-rose-200" role="alert">
      {message}
    </p>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

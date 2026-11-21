'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useRealtimeStats, useSession, ROLE_LABELS } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Security Overview', hint: 'Live operational picture' },
  { href: '/emails', label: 'Email Risk Review', hint: 'Upload & analyze .eml' },
  { href: '/suppliers', label: 'Supplier Directory', hint: 'Approved contacts & domains' },
  { href: '/bank-changes', label: 'Bank-Change Control', hint: 'HOLD · callback · dual approval' },
  { href: '/queues', label: 'Verification & Approvals', hint: 'Role-restricted queues' },
  { href: '/cases', label: 'Investigation Workspace', hint: 'Alerts, cases, evidence' },
  { href: '/audit', label: 'Audit & Reporting', hint: 'Tenant-scoped history' },
  { href: '/admin', label: 'Administration', hint: 'Memberships & policy' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { actor, loading, refresh } = useSession();
  const { connected } = useRealtimeStats(refresh);

  // Unauthenticated visitors land on the demo login screen.
  useEffect(() => {
    if (!loading && !actor && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [loading, actor]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="text-sm text-slate-500">Loading BECBarrier…</p>
      </div>
    );
  }
  if (!actor) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-navy-800 bg-navy-950 text-slate-200 lg:w-72 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 px-5 py-5">
            <BrandMark className="h-9 w-9" />
            <div>
              <p className="text-base font-semibold tracking-tight text-white">BECBarrier</p>
              <p className="text-[11px] text-slate-400">Verify the sender. Protect the payment.</p>
            </div>
          </div>
          <nav aria-label="Main navigation" className="space-y-1 px-3 pb-4">
            {NAV.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-lg px-3 py-2 transition-colors ${
                    active ? 'bg-navy-800 text-white' : 'text-slate-300 hover:bg-navy-900 hover:text-white'
                  }`}
                >
                  <span className="block text-sm font-medium">{item.label}</span>
                  <span className="block text-[11px] text-slate-400">{item.hint}</span>
                </Link>
              );
            })}
          </nav>
          <div className="hidden px-5 pb-6 lg:block">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">Realtime</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-accent-500' : 'bg-slate-500'}`}
              />
              {connected ? 'Live alerts connected' : 'Polling fallback active'}
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
            <div>
              <p className="text-sm font-semibold text-navy-950">{actor.tenantName}</p>
              <p className="text-xs text-slate-500">
                Tenant <span className="font-mono">{actor.tenantSlug}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-medium text-navy-950">{actor.userName}</p>
                <p className="text-xs text-slate-500">{ROLE_LABELS[actor.role] ?? actor.role}</p>
              </div>
              <Link
                href="/login"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Switch role
              </Link>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
      <footer className="border-t border-slate-200 bg-white px-6 py-3 text-center text-xs text-slate-500">
        BECBarrier · Independent Engineering Portfolio Project · © 2026 Etalyah Simpson · All rights reserved.{' '}
        <a
          href="https://etalyahsimpson.github.io/"
          className="ml-1 text-info-500 underline-offset-2 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Official Portfolio
        </a>
      </footer>
    </div>
  );
}

/** Shield enclosing a verified payment route — the BECBarrier mark. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <path d="M24 3 6 9v13c0 10.6 7.3 19.7 18 23 10.7-3.3 18-12.4 18-23V9L24 3Z" fill="#12263B" />
      <path
        d="M13 24h7l3.5-6 4 11 3-5h4.5"
        fill="none"
        stroke="#12B8A6"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M24 8.5 10.5 13.5v8.8c0 8.2 5.5 15.4 13.5 18.2 8-2.8 13.5-10 13.5-18.2v-8.8L24 8.5Z" fill="none" stroke="#2BD9C6" strokeWidth="1.4" opacity="0.55" />
    </svg>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { BrandMark } from '@/components/app-shell';
import { Badge, Card } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/session';

interface DemoIdentity {
  userId: string;
  userName: string;
  email: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['demo-identities'],
    queryFn: () => api<{ identities: DemoIdentity[] }>('/auth/demo-identities'),
    retry: false,
  });

  useEffect(() => {
    // Already signed in → straight to the overview.
    api<{ userId: string }>('/auth/me')
      .then(() => router.replace('/'))
      .catch(() => undefined);
  }, [router]);

  async function login(identity: DemoIdentity) {
    setBusy(identity.userId);
    setError(null);
    try {
      await api('/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ userId: identity.userId, tenantId: identity.tenantId }),
      });
      router.push('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      setBusy(null);
    }
  }

  const tenants = new Map<string, DemoIdentity[]>();
  for (const identity of data?.identities ?? []) {
    const list = tenants.get(identity.tenantSlug) ?? [];
    list.push(identity);
    tenants.set(identity.tenantSlug, list);
  }

  return (
    <div className="flex min-h-screen flex-col bg-navy-950">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-10">
        <div className="flex items-center gap-3">
          <BrandMark className="h-12 w-12" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">BECBarrier</h1>
            <p className="text-sm text-slate-400">Verify the sender. Protect the payment. Preserve the evidence.</p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-navy-950">Sign in to the demo workspace</h2>
          <p className="mt-1 text-sm text-slate-600">
            This local deployment uses a <strong>development-only identity adapter</strong> with synthetic users
            across two tenants. It demonstrates role separation without claiming enterprise authentication — a
            real deployment uses an OIDC provider with PKCE and MFA policy.
          </p>

          {isLoading && <p className="mt-4 text-sm text-slate-500">Loading demo identities…</p>}
          {loadError && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-denied">
              Demo identities are unavailable. The adapter exists only in development/test environments.
            </p>
          )}
          {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-denied">{error}</p>}

          <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
            {[...tenants.entries()].map(([slug, identities]) => (
              <div key={slug}>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {identities[0]!.tenantName}
                </p>
                <ul className="mt-2 space-y-2">
                  {identities.map((identity) => (
                    <li key={`${identity.userId}-${identity.role}`}>
                      <button
                        type="button"
                        onClick={() => login(identity)}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left transition-colors hover:border-accent-500 hover:bg-canvas disabled:opacity-60"
                      >
                        <span>
                          <span className="block text-sm font-medium text-navy-950">{identity.userName}</span>
                          <span className="block text-xs text-slate-500">{identity.email}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge tone="info">{ROLE_LABELS[identity.role] ?? identity.role}</Badge>
                          <span aria-hidden className="text-slate-400">→</span>
                        </span>
                        {busy === identity.userId && <span className="text-xs text-slate-500">Signing in…</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <Card className="mt-6 border-navy-800 bg-navy-900 text-slate-300" title="What this workspace demonstrates">
          <p className="text-sm text-slate-400">
            Blocked suspicious requests, legitimate-but-still-verified changes, and privilege/concurrency failures —
            all recorded in a tenant-scoped, HMAC-chained audit trail. No funds move: BECBarrier produces a
            controlled release instruction for an external ERP update only.
          </p>
        </Card>
      </div>
      <footer className="px-6 py-4 text-center text-xs text-slate-500">
        BECBarrier · Independent Engineering Portfolio Project · © 2026 Etalyah Simpson · All rights reserved.
      </footer>
    </div>
  );
}

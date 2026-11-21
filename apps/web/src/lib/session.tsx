'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Actor {
  userId: string;
  userName: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
}

interface SessionContextValue {
  actor: Actor | null;
  loading: boolean;
  refresh: () => void;
}

const SessionContext = createContext<SessionContextValue>({ actor: null, loading: true, refresh: () => {} });

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}

export const ROLE_LABELS: Record<string, string> = {
  FINANCE_INITIATOR: 'Finance Initiator',
  SUPPLIER_VERIFIER: 'Supplier Verifier',
  FINANCE_APPROVER: 'Finance Approver',
  SECURITY_ANALYST: 'Security Analyst',
  AUDITOR: 'Auditor',
  TENANT_ADMIN: 'Tenant Administrator',
};

function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['session'],
    queryFn: () => api<Actor>('/auth/me'),
    retry: false,
    staleTime: 60_000,
  });

  const value = useMemo<SessionContextValue>(
    () => ({
      actor: data ?? null,
      loading: isLoading,
      refresh: () => {
        void refetch();
        void queryClient.invalidateQueries();
      },
    }),
    [data, isLoading, refetch, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}

/**
 * Realtime counts via authenticated, tenant-scoped WebSocket with a polling
 * fallback. Realtime is convenience only — polling stays authoritative.
 */
export function useRealtimeStats(onEvent?: () => void) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  const handle = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['summary'] });
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    onEvent?.();
  }, [queryClient, onEvent]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(handle, 15_000);
    };
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = null;
    };

    try {
      const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost'}`;
      ws = new WebSocket(`${wsBase.replace(/\/$/, '')}/ws`);
      ws.onopen = () => {
        if (closed) return;
        setConnected(true);
        stopPolling();
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as { type: string };
          if (message.type === 'alert_created' || message.type === 'stats_update') handle();
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) startPolling();
      };
      ws.onerror = () => {
        setConnected(false);
      };
    } catch {
      startPolling();
    }

    // Poll anyway at a slower cadence even when connected (belt and braces).
    const slowPoll = setInterval(handle, 60_000);

    return () => {
      closed = true;
      clearInterval(slowPoll);
      stopPolling();
      ws?.close();
    };
  }, [handle]);

  return { connected };
}

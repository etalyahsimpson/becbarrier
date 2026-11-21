'use client';

/**
 * Typed API client for the BECBarrier authoritative API. Same-origin via the
 * Next.js rewrite; session cookie flows automatically; CSRF token is read
 * from the non-HttpOnly cookie for state-changing requests.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)bb_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body) {
    headers.set('content-type', 'application/json');
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers.set('x-csrf-token', csrfToken());
  }
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let code = 'TEMPORARILY_UNAVAILABLE';
    let message = `Request failed with HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // non-JSON error
    }
    throw new ApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** POST with an Idempotency-Key for safely repeatable mutations. */
export function apiIdempotent<T>(path: string, body: unknown, key: string): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

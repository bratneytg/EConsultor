import type { AuthResponse, PublicUser } from '@econsultor/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * El access token vive SOLO en memoria (no en localStorage): un XSS no puede exfiltrarlo para
 * uso posterior. La sesión persiste gracias a la cookie httpOnly de refresco.
 */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
export const setSessionLostHandler = (fn: () => void) => { onSessionLost = fn; };
export const setAccessToken = (t: string | null) => { accessToken = t; };

let refreshing: Promise<{ user: PublicUser } | null> | null = null;

/** Renovación con "single-flight": varias peticiones concurrentes comparten un único refresh. */
export function refreshSession(): Promise<{ user: PublicUser } | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'econsultor' } });
      if (!res.ok) { accessToken = null; return null; }
      const data = (await res.json()) as { accessToken: string; user: PublicUser };
      accessToken = data.accessToken;
      return { user: data.user };
    } catch {
      return null;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function raw(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const opts: RequestInit = { ...rest, body: json !== undefined ? JSON.stringify(json) : rest.body };
  let res = await raw(path, opts);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const ok = await refreshSession();
    if (ok) res = await raw(path, opts);
    else { onSessionLost?.(); }
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.message ?? 'Algo ha salido mal');
  return body as T;
}

export const authApi = {
  login: (identifier: string, password: string) => api<AuthResponse>('/auth/login', { method: 'POST', json: { identifier, password } }),
  register: (d: { email: string; password: string; displayName: string }) =>
    api<AuthResponse>('/auth/register', {
      method: 'POST',
      json: { ...d, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    }),
  mfa: (mfaToken: string, v: { code?: string; recoveryCode?: string }) => api<AuthResponse>('/auth/mfa/verify', { method: 'POST', json: { mfaToken, ...v } }),
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
};

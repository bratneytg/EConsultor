import type { AuthResponse, PublicUser } from '@econsultor/shared';
import { getLang, t } from './i18n';

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

/** Última vez que la persona tocó la pantalla. Solo con actividad reciente se marcan las peticiones como «activas». */
let lastInput = Date.now();
export const touchActivity = () => { lastInput = Date.now(); };
export const msSinceInput = () => Date.now() - lastInput;
const RECENT_MS = 90_000;

/** Motivo por el que se perdió la sesión, para avisar en la pantalla de acceso. */
export const flagIdle = () => { try { sessionStorage.setItem('ec_idle', '1'); } catch { /* sin almacenamiento */ } };
export const takeIdleFlag = (): boolean => {
  try { const v = sessionStorage.getItem('ec_idle') === '1'; sessionStorage.removeItem('ec_idle'); return v; } catch { return false; }
};

let refreshing: Promise<{ user: PublicUser } | null> | null = null;

/** Renovación con "single-flight": varias peticiones concurrentes comparten un único refresh. */
export function refreshSession(opened = false): Promise<{ user: PublicUser } | null> {
  refreshing ??= (async () => {
    try {
      // Abrir la app cuenta como actividad; el refresco automático en segundo plano no.
      const headers: Record<string, string> = { 'x-requested-with': 'econsultor', 'x-lang': getLang() };
      if (opened) headers['x-user-active'] = '1';
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers });
      if (!res.ok) {
        accessToken = null;
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        if (b.error === 'idle_timeout') flagIdle();
        return null;
      }
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
  headers.set('x-lang', getLang());
  if (msSinceInput() < RECENT_MS) headers.set('x-user-active', '1');
  return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const opts: RequestInit = { ...rest, body: json !== undefined ? JSON.stringify(json) : rest.body };
  let res = await raw(path, opts);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const why = (await res.clone().json().catch(() => ({}))) as { error?: string };
    if (why.error === 'idle_timeout') { flagIdle(); accessToken = null; onSessionLost?.(); throw new ApiError(401, 'idle_timeout', t('Sesión cerrada por inactividad')); }
    const ok = await refreshSession();
    if (ok) res = await raw(path, opts);
    else { onSessionLost?.(); }
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'error', body.message ?? t('Algo ha salido mal'));
  return body as T;
}

/** Descarga un archivo (p. ej. el informe en PDF) con la sesión actual. */
export async function apiBlob(path: string): Promise<Blob> {
  let res = await raw(path, {});
  if (res.status === 401) {
    const ok = await refreshSession();
    if (ok) res = await raw(path, {});
    else onSessionLost?.();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? t('Algo ha salido mal'));
  }
  return res.blob();
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

import type { AuthResponse, PublicUser } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IDLE_TIMEOUT_MIN } from '@econsultor/shared';
import { authApi, flagIdle, msSinceInput, refreshSession, setAccessToken, setSessionLostHandler, touchActivity } from './api';

interface AuthState {
  user: PublicUser | null;
  ready: boolean;
  /** Devuelve `mfaToken` si hace falta el segundo factor. */
  accept: (res: AuthResponse) => string | null;
  setUser: (u: PublicUser) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    setSessionLostHandler(() => { setUser(null); qc.clear(); });
    refreshSession(true).then((r) => { setUser(r?.user ?? null); setReady(true); });
  }, [qc]);

  // Cierre por inactividad: a los 10 min sin tocar la app (salvo «Mantener conectado»). El servidor lo exige igualmente.
  const idleOn = !!user && !user.keepSignedIn;
  useEffect(() => {
    if (!idleOn) return;
    let last = 0;
    const mark = () => { const t = Date.now(); if (t - last > 1000) { last = t; touchActivity(); } };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    const check = () => {
      if (msSinceInput() > IDLE_TIMEOUT_MIN * 60_000) {
        flagIdle();
        void (async () => { try { await authApi.logout(); } catch { /* ya sin sesión */ } setAccessToken(null); setUser(null); qc.clear(); })();
      }
    };
    const timer = window.setInterval(check, 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    touchActivity();
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [idleOn, qc]);

  const accept = useCallback((res: AuthResponse) => {
    if (res.mfaRequired) return res.mfaToken;
    setAccessToken(res.accessToken);
    setUser(res.user);
    return null;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ya sin sesión */ }
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo(() => ({ user, ready, accept, setUser, logout }), [user, ready, accept, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}

export function useUser(): PublicUser {
  const { user } = useAuth();
  if (!user) throw new Error('Sin usuario');
  return user;
}

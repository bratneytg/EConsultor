import type { AuthResponse, PublicUser } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IDLE_TIMEOUT_MIN } from '@econsultor/shared';
import { getLang, langChosenHere, useI18n } from './i18n';
import { applyCategoryPrefs } from './categories';
import { api, authApi, flagIdle, msSinceInput, refreshSession, setAccessToken, setSessionLostHandler, touchActivity } from './api';

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
  const [user, setUserRaw] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  // Las categorías propias se conocen en cuanto hay usuario, antes de pintar nada que las use.
  const setUser = useCallback((u: PublicUser | null) => { if (u) applyCategoryPrefs(u.categoryPrefs); setUserRaw(u); }, []);
  const qc = useQueryClient();
  const { setLang } = useI18n();

  // Idioma: si se eligió a mano en este dispositivo manda esa elección (se guarda en la cuenta); si no, el de la cuenta.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    if (langChosenHere()) {
      if (user.language !== getLang()) void api<PublicUser>('/me/settings', { method: 'PATCH', json: { language: getLang() } }).then(setUser).catch(() => undefined);
    } else if (user.language !== getLang()) setLang(user.language, false);
  }, [user, setLang, setUser]);

  useEffect(() => {
    setSessionLostHandler(() => { setUser(null); qc.clear(); });
    refreshSession(true).then((r) => { setUser(r?.user ?? null); setReady(true); });
  }, [qc, setUser]);

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
  }, [idleOn, qc, setUser]);

  const accept = useCallback((res: AuthResponse) => {
    if (res.mfaRequired) return res.mfaToken;
    setAccessToken(res.accessToken);
    setUser(res.user);
    return null;
  }, [setUser]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ya sin sesión */ }
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc, setUser]);

  const value = useMemo(() => ({ user, ready, accept, setUser, logout }), [user, ready, accept, setUser, logout]);
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

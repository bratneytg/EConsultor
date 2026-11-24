import type { AuthResponse, PublicUser } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, refreshSession, setAccessToken, setSessionLostHandler } from './api';

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
    refreshSession().then((r) => { setUser(r?.user ?? null); setReady(true); });
  }, [qc]);

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

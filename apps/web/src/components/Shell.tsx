import type { Transaction } from '@econsultor/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useUser } from '../lib/auth';
import { isoToday } from '../lib/format';
import { AddSheet } from './AddSheet';
import { ImportSheet } from './ImportSheet';
import { Icon, type IconName } from './Icon';
import { Toast } from './ui';

interface ShellCtx {
  month: string;
  setMonth: (m: string) => void;
  today: string;
  openAdd: (editing?: Transaction) => void;
  openImport: () => void;
  toast: (t: string) => void;
}
const Ctx = createContext<ShellCtx | null>(null);
export const useShell = (): ShellCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell fuera del Shell');
  return v;
};

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Resumen', icon: 'pulse' },
  { to: '/movimientos', label: 'Movimientos', icon: 'list' },
  { to: '/consejos', label: 'Consejos', icon: 'spark' },
  { to: '/ajustes', label: 'Ajustes', icon: 'gear' },
];

export function Shell() {
  const user = useUser();
  const today = isoToday(user.timezone);
  const [month, setMonthState] = useState(today.slice(0, 7));
  const [sheet, setSheet] = useState<{ open: boolean; editing: Transaction | null }>({ open: false, editing: null });
  const [importing, setImporting] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  // Nunca se navega al futuro.
  const setMonth = useCallback((m: string) => setMonthState(m > today.slice(0, 7) ? today.slice(0, 7) : m), [today]);
  const openAdd = useCallback((editing?: Transaction) => setSheet({ open: true, editing: editing ?? null }), []);
  const openImport = useCallback(() => setImporting(true), []);
  const toast = useCallback((t: string) => {
    setToastText(t);
    setTimeout(() => setToastText(null), 2200);
  }, []);

  // /?add=1 (atajo de la PWA y clic en la notificación) abre la hoja de anotar.
  useEffect(() => {
    if (params.get('add') === '1') {
      openAdd();
      params.delete('add');
      setParams(params, { replace: true });
    }
  }, [params, setParams, openAdd]);

  const value = useMemo(() => ({ month, setMonth, today, openAdd, openImport, toast }), [month, setMonth, today, openAdd, openImport, toast]);

  const tab = (n: (typeof NAV)[number]) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'} className="tab">
      <Icon name={n.icon} />
      {n.label}
    </NavLink>
  );

  return (
    <Ctx.Provider value={value}>
      <div className="shell">
        <nav className="nav-rail" aria-label="Principal">
          <div className="brand"><img src="/icons/icon-192.png" alt="" />EConsultor</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{n.label}</NavLink>
          ))}
          <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />Anotar</button>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 13, padding: '0 14px' }}>{user.displayName}</span>
        </nav>

        <main id="main">
          <Outlet />
        </main>

        <nav className="tabbar" aria-label="Principal">
          {tab(NAV[0]!)}
          {tab(NAV[1]!)}
          <button className="fab" aria-label="Anotar movimiento" onClick={() => openAdd()}><Icon name="plus" size={26} /></button>
          {tab(NAV[2]!)}
          {tab(NAV[3]!)}
        </nav>
      </div>
      <AddSheet open={sheet.open} editing={sheet.editing} onClose={() => setSheet((s) => ({ ...s, open: false }))} onDone={toast} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} onDone={toast} />
      <Toast text={toastText} />
    </Ctx.Provider>
  );
}

import type { Transaction } from '@econsultor/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useUser } from '../lib/auth';
import { isoToday } from '../lib/format';
import { markSeen, pendingReleases, RELEASES, type Release } from '../content/novedades';
import { AddSheet } from './AddSheet';
import { ImportSheet } from './ImportSheet';
import { ReportSheet } from './ReportSheet';
import { t, tk } from '../lib/i18n';
import { syncNativeReminder } from '../lib/native';
import { Icon, type IconName } from './Icon';
import { Toast } from './ui';
import { UpdateBanner, WhatsNew } from './WhatsNew';

interface ShellCtx {
  month: string;
  setMonth: (m: string) => void;
  today: string;
  openAdd: (editing?: Transaction) => void;
  openImport: () => void;
  openReport: () => void;
  openWhatsNew: () => void;
  toast: (t: string) => void;
}
const Ctx = createContext<ShellCtx | null>(null);
export const useShell = (): ShellCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell fuera del Shell');
  return v;
};

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: tk('Resumen'), icon: 'pulse' },
  { to: '/movimientos', label: tk('Movimientos'), icon: 'list' },
  { to: '/consejos', label: tk('Consejos'), icon: 'spark' },
  { to: '/ajustes', label: tk('Ajustes'), icon: 'gear' },
];

export function Shell() {
  const user = useUser();
  const today = isoToday(user.timezone);
  const [month, setMonthState] = useState(today.slice(0, 7));
  const [sheet, setSheet] = useState<{ open: boolean; editing: Transaction | null }>({ open: false, editing: null });
  const [importing, setImporting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [news, setNews] = useState<{ open: boolean; releases: Release[] }>({ open: false, releases: [] });
  const [updateReady, setUpdateReady] = useState(false);

  // Al abrir la app tras una actualización, se enseña qué ha cambiado (una sola vez por versión).
  useEffect(() => {
    const releases = pendingReleases(user.id, user.createdAt, __APP_VERSION__);
    if (releases.length) setNews({ open: true, releases });
  }, [user.id, user.createdAt]);
  const closeNews = useCallback(() => { markSeen(user.id, __APP_VERSION__); setNews((n) => ({ ...n, open: false })); }, [user.id]);
  const openWhatsNew = useCallback(() => setNews({ open: true, releases: RELEASES.slice(0, 3) }), []);

  // La app instalada se queda abierta días: se busca una versión nueva al volver a ella y cada media hora.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let controlled = !!navigator.serviceWorker.controller;
    const onChange = () => { if (controlled) setUpdateReady(true); controlled = true; };
    const check = () => { void navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => { navigator.serviceWorker.removeEventListener('controllerchange', onChange); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, []);

  // Nunca se navega al futuro.
  const setMonth = useCallback((m: string) => setMonthState(m > today.slice(0, 7) ? today.slice(0, 7) : m), [today]);
  const openAdd = useCallback((editing?: Transaction) => setSheet({ open: true, editing: editing ?? null }), []);
  const openImport = useCallback(() => setImporting(true), []);
  const openReport = useCallback(() => setReporting(true), []);
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

  // En la app de Android el aviso diario lo programa el propio teléfono: se mantiene al día con los ajustes.
  useEffect(() => { syncNativeReminder(user.reminderEnabled, user.reminderTime); }, [user.reminderEnabled, user.reminderTime]);

  const value = useMemo(() => ({ month, setMonth, today, openAdd, openImport, openReport, openWhatsNew, toast }), [month, setMonth, today, openAdd, openImport, openReport, openWhatsNew, toast]);

  const tab = (n: (typeof NAV)[number]) => (
    <NavLink key={n.to} to={n.to} end={n.to === '/'} className="tab">
      <Icon name={n.icon} />
      {t(n.label)}
    </NavLink>
  );

  return (
    <Ctx.Provider value={value}>
      <div className="shell">
        <nav className="nav-rail" aria-label={t('Principal')}>
          <div className="brand"><img src="/icons/icon-192.png" alt="" />{t('EConsultor')}</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{t(n.label)}</NavLink>
          ))}
          <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />{t('Anotar')}</button>
          <div className="spacer" />
          <NavLink to="/ayuda" className="rail-help"><Icon name="help" />{t('Ayuda')}</NavLink>
          <span className="muted" style={{ fontSize: 13, padding: '0 14px' }}>{user.displayName}</span>
        </nav>

        <main id="main">
          <Outlet />
        </main>
        <button className="report-dot" aria-label={t('Reportar un fallo')} title={t('Reportar un fallo')} onClick={openReport}><Icon name="bug" size={16} /></button>

        <nav className="tabbar" aria-label={t('Principal')}>
          {tab(NAV[0]!)}
          {tab(NAV[1]!)}
          <button className="fab" aria-label={t('Anotar movimiento')} onClick={() => openAdd()}><Icon name="plus" size={26} /></button>
          {tab(NAV[2]!)}
          {tab(NAV[3]!)}
        </nav>
      </div>
      <AddSheet open={sheet.open} editing={sheet.editing} onClose={() => setSheet((s) => ({ ...s, open: false }))} onDone={toast} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} onDone={toast} />
      <ReportSheet open={reporting} onClose={() => setReporting(false)} onDone={toast} />
      <WhatsNew open={news.open} releases={news.releases} version={__APP_VERSION__} onClose={closeNews} />
      {updateReady && !news.open && <UpdateBanner onReload={() => window.location.reload()} />}
      <Toast text={toastText} />
    </Ctx.Provider>
  );
}

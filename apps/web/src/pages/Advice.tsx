import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdviceResponse } from '@econsultor/shared';
import { AdviceCard } from '../components/AdviceCard';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { Card } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { useAdvice, useAppConfig, useDetailedAdvice } from '../lib/queries';
import type { PublicUser } from '@econsultor/shared';

export function Advice() {
  const user = useUser();
  const { setUser } = useAuth();
  const { toast } = useShell();
  const qc = useQueryClient();
  const { data, isPending, isFetching, isError } = useAdvice();
  const { data: cfg } = useAppConfig();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'general' | 'detailed'>('general');
  const detailed = useDetailedAdvice(tab === 'detailed');
  const [askAi, setAskAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const runAi = async () => {
    setAiBusy(true);
    try {
      const fresh = await api<AdviceResponse>('/advice/detailed?ai=1&refresh=1');
      qc.setQueryData(['advice', 'detailed'], fresh);
      setAskAi(false);
      if (fresh.source !== 'ai') toast('La IA no ha podido responder ahora; te muestro el análisis local.');
    } catch { toast('No se pudo generar el análisis con IA'); } finally { setAiBusy(false); }
  };
  const refreshDetailed = async () => {
    setBusy(true);
    try { qc.setQueryData(['advice', 'detailed'], await api<AdviceResponse>(`/advice/detailed?refresh=1${detailed.data?.source === 'ai' ? '&ai=1' : ''}`)); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const fresh = await api<NonNullable<typeof data>>('/advice?refresh=1');
      qc.setQueryData(['advice'], fresh);
    } finally { setBusy(false); }
  };

  const goPremium = async () => {
    const u = await api<PublicUser>('/dev/plan', { method: 'POST', json: { plan: 'premium' } });
    setUser(u);
    await qc.invalidateQueries({ queryKey: ['advice'] });
    toast('Premium activado (modo demostración)');
  };

  const locked = (n: number, text: string) => (
    <article className="advice-card locked">
      <Icon name="lock" size={26} />
      <h3>{n} {n === 1 ? 'consejo más' : 'consejos más'} con Premium</h3>
      <p>{text}</p>
      {cfg?.demo ? <button className="btn btn-primary" onClick={goPremium}>Probar Premium (demo)</button> : <span className="badge">Próximamente</span>}
    </article>
  );

  const empty = (
    <Card><div className="empty"><h3>No hemos podido generar tus consejos</h3><p>Vuelve a intentarlo en unos segundos.</p></div></Card>
  );
  const loading = <div className="loading-screen" style={{ minHeight: 240 }}><div className="pulse-dot" /></div>;
  const dd = detailed.data;

  return (
    <div>
      <header className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>Hechos a partir de tus números</p>
          <h1>Consejos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data && <span className={`badge ${user.plan === 'premium' ? 'premium' : ''}`}>{user.plan === 'premium' ? ((tab === 'general' ? data.source : dd?.source) === 'ai' ? 'Premium · IA' : 'Premium') : 'Gratis'}</span>}
          {user.plan === 'premium' && tab === 'general' && <button className="chip-btn" disabled={busy || isFetching} onClick={refresh}><Icon name="refresh" size={14} /> Actualizar</button>}
          {user.plan === 'premium' && tab === 'detailed' && <button className="chip-btn" disabled={busy || detailed.isFetching} onClick={refreshDetailed}><Icon name="refresh" size={14} /> Actualizar</button>}
        </div>
      </header>

      <div className="segmented" role="group" aria-label="Tipo de consejos" style={{ marginBottom: 16 }}>
        <button aria-pressed={tab === 'general'} onClick={() => setTab('general')}>Generales</button>
        <button aria-pressed={tab === 'detailed'} onClick={() => setTab('detailed')}>A fondo</button>
      </div>

      {tab === 'general' ? (
        isPending ? loading : isError || !data ? empty : (
          <div className="advice-grid">
            {data.items.map((a) => <AdviceCard key={a.id} a={a} currency={user.currency} />)}
            {data.lockedCount > 0 && locked(data.lockedCount, 'Consejos con IA sobre cómo ahorrar más y aumentar tus ingresos, ajustados a tu historial.')}
          </div>
        )
      ) : detailed.isPending ? loading : detailed.isError || !dd ? empty : (
        <>
          <p className="sub" style={{ marginBottom: 12 }}>
            Mira en qué gastas de verdad: comercios, cuántas veces pagas, cuánto de media y qué cargos se repiten.
            {dd.basis && <> Basado en <b>{dd.basis.txCount}</b> gastos de los últimos {dd.basis.periodDays} días.</>}
          </p>

          {dd.basis?.aiAvailable && dd.source !== 'ai' && (
            <div className="ai-consent">
              <b>¿Quieres consejos aún más afinados con IA?</b>
              {askAi ? (
                <>
                  <p>Se enviará a la IA (Claude, de Anthropic) un <b>resumen</b>: totales por categoría, los comercios principales (sin IBAN, correos ni números largos), cuántas veces pagas y los importes medios. <b>No</b> se envían fechas, notas completas ni movimientos sueltos.</p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" disabled={aiBusy} onClick={runAi}>{aiBusy ? 'Analizando…' : 'Aceptar y analizar'}</button>
                    <button className="btn btn-ghost" disabled={aiBusy} onClick={() => setAskAi(false)}>Cancelar</button>
                  </div>
                </>
              ) : (
                <>
                  <p>Este análisis ya se hace en tu servidor, sin enviar nada fuera. La IA redacta consejos todavía más concretos con tus comercios.</p>
                  <div><button className="btn" onClick={() => setAskAi(true)}><Icon name="spark" size={18} />Mejorar con IA</button></div>
                </>
              )}
            </div>
          )}

          <div className="advice-grid">
            {dd.items.map((a) => <AdviceCard key={a.id} a={a} currency={user.currency} />)}
            {dd.lockedCount > 0 && locked(dd.lockedCount, 'Análisis a fondo de tus comercios, gastos repetidos y topes semanales, con lo que debes hacer en cada caso.')}
          </div>
        </>
      )}
      <p className="hint" style={{ textAlign: 'center', padding: '16px 12px 0' }}>EConsultor ofrece orientación general y no sustituye a un asesor financiero profesional.</p>
    </div>
  );
}

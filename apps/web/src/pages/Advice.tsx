import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdviceResponse, AiIssue } from '@econsultor/shared';
import { AdviceCard } from '../components/AdviceCard';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { PremiumNudge } from '../components/Premium';
import { Card } from '../components/ui';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { useAdvice, useAppConfig, useDetailedAdvice } from '../lib/queries';
import type { PublicUser } from '@econsultor/shared';
import { t, tx } from '../lib/i18n';

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
      if (fresh.source !== 'ai') toast(t('La IA no ha podido responder ahora; te muestro el análisis local.'));
    } catch { toast(t('No se pudo generar el análisis con IA')); } finally { setAiBusy(false); }
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
    toast(t('Premium activado (modo demostración)'));
  };

  /** Solo en modo demostración: activa Premium sin pagar para poder probar la IA. */
  const demoButton = cfg?.demo ? <button className="btn" onClick={goPremium}>{t('Probar Premium (demo)')}</button> : null;

  const empty = (
    <Card><div className="empty"><h3>{t('No hemos podido generar tus consejos')}</h3><p>{t('Vuelve a intentarlo en unos segundos.')}</p></div></Card>
  );
  const loading = <div className="loading-screen" style={{ minHeight: 240 }}><div className="pulse-dot" /></div>;
  const dd = detailed.data;

  /** Si la IA debía responder y no lo ha hecho, se explica por qué y qué hacer. */
  const aiNotice = (issue: AiIssue | undefined) => {
    if (!issue) return null;
    const text: Record<AiIssue, string> = {
      no_key: t('La IA no está activada en tu servidor: falta la clave de Anthropic. En el servidor ejecuta «bash scripts/servidor.sh ia» y pega la clave cuando te la pida.'),
      key: t('La clave de IA del servidor no es válida o ha caducado. Cámbiala en el servidor con «bash scripts/servidor.sh ia cambiar».'),
      model: t('El modelo de IA indicado en el servidor no está disponible. Revisa ANTHROPIC_MODEL en el archivo .env o ejecuta «bash scripts/servidor.sh ia».'),
      limit: t('La cuenta de Anthropic no tiene saldo o ha llegado a su límite. Revísalo en console.anthropic.com.'),
      busy: t('La IA está saturada en este momento. Inténtalo de nuevo en unos minutos.'),
      network: t('El servidor no consigue conectar con la IA. Revisa su conexión a internet.'),
      format: t('La IA respondió algo que no he podido leer. Pulsa «Actualizar» para intentarlo otra vez.'),
    };
    return (
      <div className="ai-consent" role="status" style={{ marginBottom: 14 }}>
        <b><Icon name="warn" size={16} /> {t('Mostrando consejos sin IA')}</b>
        <p>{text[issue]}</p>
      </div>
    );
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>{t('Hechos a partir de tus números')}</p>
          <h1>{t('Consejos')}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data && (user.plan === 'premium'
            ? <span className="badge premium">{(tab === 'general' ? data.source : dd?.source) === 'ai' ? t('Premium · IA') : t('Premium')}</span>
            : <Link to="/premium" className="badge badge-link">{t('Gratis')} · {t('Mejorar')}</Link>)}
          {user.plan === 'premium' && tab === 'general' && <button className="chip-btn" disabled={busy || isFetching} onClick={refresh}><Icon name="refresh" size={14} /> {t('Actualizar')}</button>}
          {user.plan === 'premium' && tab === 'detailed' && <button className="chip-btn" disabled={busy || detailed.isFetching} onClick={refreshDetailed}><Icon name="refresh" size={14} /> {t('Actualizar')}</button>}
        </div>
      </header>

      <div className="segmented" role="group" aria-label={t('Tipo de consejos')} style={{ marginBottom: 16 }}>
        <button aria-pressed={tab === 'general'} onClick={() => setTab('general')}>{t('Generales')}</button>
        <button aria-pressed={tab === 'detailed'} onClick={() => setTab('detailed')}>{t('A fondo')}</button>
      </div>

      {tab === 'general' ? (
        isPending ? loading : isError || !data ? empty : (
          <>
            {aiNotice(data.aiIssue)}
            <div className="advice-grid">
              {data.items.map((a) => <AdviceCard key={a.id} a={a} currency={user.currency} />)}
              {user.plan !== 'premium' && (
                <PremiumNudge title={t('Consejos escritos por IA')} text={t('Con Premium, la IA lee tus movimientos y te dice cómo ahorrar más y aumentar tus ingresos, con tus comercios y tus hábitos.')}>{demoButton}</PremiumNudge>
              )}
            </div>
          </>
        )
      ) : detailed.isPending ? loading : detailed.isError || !dd ? empty : (
        <>
          <p className="sub" style={{ marginBottom: 12 }}>
            {t('Mira en qué gastas de verdad: comercios, cuántas veces pagas, cuánto de media y qué cargos se repiten.')}
            {dd.basis && <> {tx('Basado en <b>{count}</b> gastos de los últimos {days} días.', { count: dd.basis.txCount, days: dd.basis.periodDays })}</>}
          </p>

          {aiNotice(dd.aiIssue)}

          {user.plan !== 'premium' && dd.basis && (
            <PremiumNudge variant="panel" title={t('¿Quieres consejos aún más afinados con IA?')} text={t('Este análisis ya se hace en el servidor, sin enviar nada fuera. Con Premium, la IA redacta consejos todavía más concretos con tus comercios.')}>{demoButton}</PremiumNudge>
          )}

          {dd.basis?.aiAvailable && dd.source !== 'ai' && (
            <div className="ai-consent">
              <b>{t('¿Quieres consejos aún más afinados con IA?')}</b>
              {askAi ? (
                <>
                  <p>{tx('Se enviará a la IA (Claude, de Anthropic) un <b>resumen</b>: totales por categoría, los comercios principales (sin IBAN, correos ni números largos), cuántas veces pagas y los importes medios. <b>No</b> se envían fechas, notas completas ni movimientos sueltos.')}</p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" disabled={aiBusy} onClick={runAi}>{aiBusy ? t('Analizando…') : t('Aceptar y analizar')}</button>
                    <button className="btn btn-ghost" disabled={aiBusy} onClick={() => setAskAi(false)}>{t('Cancelar')}</button>
                  </div>
                </>
              ) : (
                <>
                  <p>{t('Este análisis ya se hace en tu servidor, sin enviar nada fuera. La IA redacta consejos todavía más concretos con tus comercios.')}</p>
                  <div><button className="btn" onClick={() => setAskAi(true)}><Icon name="spark" size={18} />{t('Mejorar con IA')}</button></div>
                </>
              )}
            </div>
          )}

          <div className="advice-grid">
            {dd.items.map((a) => <AdviceCard key={a.id} a={a} currency={user.currency} />)}
          </div>
        </>
      )}
      <p className="hint" style={{ textAlign: 'center', padding: '16px 12px 0' }}>{t('EConsultor ofrece orientación general y no sustituye a un asesor financiero profesional.')}</p>
    </div>
  );
}

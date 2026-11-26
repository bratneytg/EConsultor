import type { CaptureInfo, CaptureMode } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { dayShort } from '../lib/format';
import { t, tk } from '../lib/i18n';
import { captureApps, captureDisable, captureSetApps, captureSetup, captureStatus, captureSupported, isAndroidApp, openNotificationAccess, type CaptureApp, type NativeCaptureStatus } from '../lib/native';
import { useCapture } from '../lib/queries';
import { Card } from './ui';
import { Icon } from './Icon';
import { useShell } from './Shell';

/** El token solo se ve al crearlo: se recuerda mientras la pestaña siga abierta para poder copiarlo en la guía. */
let shownToken: string | null = null;

const MODES: { id: CaptureMode; title: string; text: string }[] = [
  { id: 'smart', title: tk('Inteligente'), text: tk('Añade solo lo que reconoce (Mercadona, Netflix, Lidl…). Lo dudoso espera a que lo revises.') },
  { id: 'review', title: tk('Revisarlo todo'), text: tk('Nada se añade solo: cada pago espera en pendientes hasta que lo confirmes.') },
  { id: 'auto', title: tk('Automático'), text: tk('Lo añade todo al momento, con la mejor categoría que encuentre. Puedes corregirlo después.') },
];

function CopyLine({ value, label }: { value: string; label: string }) {
  const { toast } = useShell();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast(t('Copiado')); } catch { toast(t('No se pudo copiar. Selecciónalo y cópialo a mano.')); }
  };
  return (
    <div className="copyline">
      <code aria-label={label}>{value}</code>
      <button type="button" className="btn" aria-label={t('Copiar {name}', { name: label })} onClick={copy}><Icon name="copy" size={18} /></button>
    </div>
  );
}

/** Captura automática de pagos: Atajo de iPhone (Wallet) y notificaciones de Android, sin conectar ningún banco. */
export function CaptureCard() {
  const { toast, openPending } = useShell();
  const qc = useQueryClient();
  const { data } = useCapture();
  const [token, setToken] = useState<string | null>(shownToken);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'revoke' | 'regen' | null>(null);
  const [error, setError] = useState('');
  const [apps, setApps] = useState<CaptureApp[]>([]);
  const [nat, setNat] = useState<NativeCaptureStatus | null>(null);
  const canNative = isAndroidApp() && captureSupported();

  const setInfo = useCallback((i: CaptureInfo) => qc.setQueryData(['capture'], i), [qc]);
  const readNative = useCallback(() => { setApps(captureApps()); setNat(captureStatus()); }, []);
  useEffect(() => {
    if (!canNative || !data?.enabled) return;
    readNative();
    // Al volver de los ajustes de Android (donde se da el permiso) se vuelve a mirar.
    const on = () => document.visibilityState === 'visible' && readNative();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [canNative, data?.enabled, readNative]);

  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<CaptureInfo & { token: string }>('/capture/token', { method: 'POST' });
      shownToken = r.token; setToken(r.token); setInfo(r); setConfirm(null);
      if (canNative) { captureSetup(window.location.origin, r.token); setTimeout(readNative, 300); }
    } catch (e) { setError(e instanceof ApiError ? e.message : t('No se pudo completar. Inténtalo de nuevo.')); } finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true); setError('');
    try {
      setInfo(await api<CaptureInfo>('/capture/token', { method: 'DELETE' }));
      shownToken = null; setToken(null); setConfirm(null);
      if (canNative) captureDisable();
      toast(t('Captura desactivada'));
    } catch (e) { setError(e instanceof ApiError ? e.message : t('No se pudo completar. Inténtalo de nuevo.')); } finally { setBusy(false); }
  };
  const setMode = async (mode: CaptureMode) => {
    setInfo(await api<CaptureInfo>('/capture/settings', { method: 'PUT', json: { mode } }));
  };
  const test = async () => {
    setBusy(true);
    try {
      setInfo(await api<CaptureInfo>('/capture/test', { method: 'POST' }));
      toast(t('Prueba enviada: la tienes en pagos pendientes.'));
      openPending();
    } catch (e) { toast(e instanceof ApiError ? e.message : t('No se pudo completar. Inténtalo de nuevo.')); } finally { setBusy(false); }
  };
  const dropIgnored = async (id: string) => setInfo(await api<CaptureInfo>(`/capture/ignored/${id}`, { method: 'DELETE' }));
  const toggleApp = (pkg: string) => {
    const next = apps.map((a) => (a.pkg === pkg ? { ...a, on: !a.on } : a));
    setApps(next);
    captureSetApps(next.filter((a) => a.on).map((a) => a.pkg));
  };

  const endpoint = data?.endpoint ?? `${window.location.origin}/api/capture/in`;
  const tokenText = token ?? 'ecp_…';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (!data) return <Card title={t('Captura automática de pagos')}><div className="loading-screen" style={{ minHeight: 120 }}><div className="pulse-dot" /></div></Card>;

  return (
    <>
      <Card title={t('Captura automática de pagos')} subtitle={t('Tus pagos con el móvil entran solos, sin conectar ningún banco: no importa cuál uses.')}>
        {!data.enabled ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>{t('En iPhone, un Atajo de Apple envía cada pago hecho con Apple Pay. En Android, la app lee el aviso que te manda tu banco o Google Wallet. Solo se envían los avisos de pago de las apps que elijas, y el servidor solo apunta el comercio y el importe.')}</p>
            <button className="btn btn-primary" disabled={busy} onClick={create}><Icon name="bolt" size={18} />{t('Activar captura de pagos')}</button>
          </>
        ) : (
          <>
            {token && (
              <div className="notice" role="status">
                <b>{t('Tu token personal')}</b>
                <div className="secret"><code aria-label={t('Token')}>{token}</code></div>
                <p style={{ margin: 0 }}>{t('Cópialo ahora: por seguridad no se volverá a mostrar completo. Solo sirve para añadir pagos pendientes; no puede leer nada de tu cuenta.')}</p>
              </div>
            )}
            <div className="setting">
              <div>
                <b>{t('Captura activada')}</b>
                <p>{t('Token terminado en {hint}.', { hint: data.tokenHint ?? '' })}{' '}{data.lastUsedAt ? t('Último aviso recibido: {day}.', { day: dayShort(data.lastUsedAt.slice(0, 10)) }) : t('Aún no ha llegado ningún aviso.')}</p>
              </div>
              <button className="btn" disabled={busy} onClick={test}>{t('Enviar una prueba')}</button>
            </div>
            {data.items.length > 0 && (
              <div className="setting">
                <div><b>{data.items.length === 1 ? t('1 pago pendiente') : t('{n} pagos pendientes', { n: data.items.length })}</b></div>
                <button className="btn btn-primary" onClick={openPending}>{t('Revisar')}</button>
              </div>
            )}

            <div className="field" style={{ marginTop: 14 }}>
              <span className="lbl">{t('¿Qué hacer con cada pago?')}</span>
              <div role="radiogroup" aria-label={t('Modo de captura')} style={{ display: 'grid', gap: 8 }}>
                {MODES.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={data.mode === m.id} className="mode-opt" onClick={() => setMode(m.id)}>
                    <span style={{ display: 'contents' }}><Icon name={data.mode === m.id ? 'check' : 'dots'} size={18} /></span>
                    <div><b>{t(m.title)}</b><span>{t(m.text)}</span></div>
                  </button>
                ))}
              </div>
              <span className="hint">{t('Los pagos en otra moneda siempre esperan a que escribas su importe en la tuya.')}</span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {confirm === 'regen' ? <button className="btn" disabled={busy} onClick={create}>{t('Sí, generar uno nuevo (el anterior dejará de funcionar)')}</button> : <button className="btn" onClick={() => setConfirm('regen')}>{t('Generar un token nuevo')}</button>}
              {confirm === 'revoke' ? <button className="btn btn-ghost" disabled={busy} onClick={revoke}>{t('Sí, desactivar la captura')}</button> : <button className="btn btn-ghost" onClick={() => setConfirm('revoke')}>{t('Desactivar')}</button>}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
          </>
        )}
      </Card>

      {data.enabled && canNative && (
        <Card title={t('Android: avisos del banco y de Google Wallet')} subtitle={t('EConsultor lee solo las notificaciones de las apps que marques aquí.')}>
          {nat && !nat.access ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>{t('Falta un permiso: en la pantalla que se abre, busca EConsultor y activa «Acceso a notificaciones». Es el permiso de Android para leer avisos.')}</p>
              <button className="btn btn-primary" onClick={openNotificationAccess}>{t('Dar acceso a las notificaciones')}</button>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>{nat ? t('Acceso concedido. Enviados: {sent}. En cola sin conexión: {queued}.', { sent: nat.sent, queued: nat.queued }) : ''}</p>
          )}
          {apps.length === 0 ? <p className="muted">{t('No he encontrado apps de bancos en este teléfono.')}</p> : apps.map((a) => (
            <div className="app-row" key={a.pkg}>
              <div><b>{a.label}</b>{!a.known && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('Otra app: actívala solo si es de un banco o de pagos.')}</p>}</div>
              <button type="button" role="switch" aria-checked={a.on} aria-label={t('Leer avisos de {name}', { name: a.label })} className="switch" onClick={() => toggleApp(a.pkg)} />
            </div>
          ))}
        </Card>
      )}

      {data.enabled && !canNative && (
        <Card title={ios ? t('iPhone: Atajo de Apple Pay') : t('Cómo conectar tu móvil')} subtitle={t('Cada vez que pagues con Apple Pay, el Atajo envía el comercio y el importe.')}>
          <p className="muted" style={{ marginTop: 0 }}>{t('Apple no deja instalar atajos que ejecuten acciones sin que los crees tú, así que son unos pasos de una sola vez (unos 3 minutos):')}</p>
          <ol className="guide">
            <li>{t('Abre la app Atajos → pestaña Automatización → «+» → Transacción.')}</li>
            <li>{t('Elige las tarjetas (o «cualquiera»), marca «Ejecutar inmediatamente» y pulsa Siguiente.')}</li>
            <li>{t('Añade la acción «Obtener contenido de la URL» y pega esta dirección:')}<CopyLine value={endpoint} label={t('dirección')} /></li>
            <li>{t('Toca «Mostrar más»: Método POST, Cuerpo de la solicitud: JSON. Añade estos campos de tipo Texto:')}
              <div className="notice" style={{ margin: '6px 0' }}>
                <code>token</code> = {token ? t('tu token (cópialo abajo)') : t('tu token personal (genera uno nuevo si no lo guardaste)')}<br />
                <code>source</code> = wallet<br />
                <code>merchant</code> = {t('variable «Comercio» (Merchant) de la entrada del atajo')}<br />
                <code>amount</code> = {t('variable «Importe» (Amount)')}
              </div>
              {token ? <CopyLine value={tokenText} label={t('token')} /> : null}
            </li>
            <li>{t('Pulsa Hecho. Haz un pago pequeño con Apple Pay para comprobarlo: el Atajo no pide confirmación.')}</li>
          </ol>
          <p className="hint" style={{ marginTop: 10 }}>{t('Solo cubre los pagos con Apple Pay en Wallet. Los de apps del banco, compras online y transferencias los captas con el extracto mensual. Si iOS no ejecuta la automatización alguna vez, ese pago llegará con el extracto y la importación evita duplicarlo.')}</p>
        </Card>
      )}

      {data.enabled && data.ignored.length > 0 && (
        <Card title={t('Avisos que no he entendido')} subtitle={t('Llegaron pero no parecían un pago (códigos, publicidad, saldos). Si alguno sí lo era, escríbenos desde «Reportar un fallo».')}
          actions={<button className="chip-btn" onClick={() => dropIgnored('all')}>{t('Borrar todos')}</button>}>
          {data.ignored.map((g) => (
            <div className="ignored-row" key={g.id}>
              <div><p>{g.text}</p><small>{dayShort(g.at.slice(0, 10))}{g.from ? ` · ${g.from}` : ''}</small></div>
              <button className="chip-btn" aria-label={t('Borrar este aviso')} onClick={() => dropIgnored(g.id)}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

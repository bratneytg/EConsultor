import type { PublicUser } from '@econsultor/shared';
import { locale, t, tk, tx } from '../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { LanguagePicker } from '../components/LanguagePicker';
import { Icon, type IconName } from '../components/Icon';
import { ModeSwitch } from '../components/ModeSwitch';
import { CaptureCard } from '../components/CaptureCard';
import { StatementReminderSetting } from '../components/StatementReminderSetting';
import { CategoriesCard } from '../components/CategoriesCard';
import { RecurringCard } from '../components/RecurringCard';
import { ReportCard } from '../components/ReportCard';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { useShell } from '../components/Shell';
import { Card, Switch } from '../components/ui';
import { Link, Navigate, useParams } from 'react-router-dom';
import { isAndroidApp, saveTextFile } from '../lib/native';
import { api, ApiError } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { useAppConfig, useInvalidateData } from '../lib/queries';
import { disablePush, enablePush, hasPushSubscription, isIOS, isStandalone, pushSupported } from '../lib/push';
import { passkeyMessage, passkeyStatus, registerPasskey, removePasskey as removeKey, statusMessage, thisDeviceKeyId, type PasskeyStatus } from '../lib/passkey';
import { applyTheme, getThemePref, type ThemePref } from '../lib/theme';

interface Section { id: string; icon: IconName; title: string; hint: string; multi?: boolean; body: ReactNode }

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL'];
const EVENT_LABEL: Record<string, string> = {
  login: tk('Inicio de sesión'), login_failed: tk('Intento de acceso fallido'), register: tk('Cuenta creada'), mfa_enabled: tk('Verificación en dos pasos activada'),
  passkey_added: tk('Huella añadida'), passkey_removed: tk('Huella eliminada'),
  mfa_disabled: tk('Verificación en dos pasos desactivada'), mfa_failed: tk('Código de verificación incorrecto'), recovery_code_used: tk('Código de recuperación usado'),
  plan_changed: tk('Plan cambiado por el administrador'), logout_all: tk('Sesiones cerradas en todos los dispositivos'), refresh_reuse_detected: tk('Sesión sospechosa bloqueada'),
};

export function Settings() {
  const user = useUser();
  const { setUser, logout } = useAuth();
  const { toast, openImport, openReport, openWhatsNew } = useShell();
  const { data: cfg } = useAppConfig();
  const invalidate = useInvalidateData();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [pushOn, setPushOn] = useState(false);
  const [name, setName] = useState(user.displayName);

  useEffect(() => { hasPushSubscription().then(setPushOn); }, []);

  const patch = async (p: Partial<{ displayName: string; currency: string; reminderEnabled: boolean; reminderTime: string }>) => {
    try { setUser(await api<PublicUser>('/me/settings', { method: 'PATCH', json: p })); toast(t('Guardado')); }
    catch (e) { toast((e as Error).message); }
  };

  const togglePush = async () => {
    if (pushOn) { await disablePush(); setPushOn(false); return toast(t('Notificaciones desactivadas')); }
    const r = await enablePush();
    if (r === 'ok') { setPushOn(true); toast(t('Notificaciones activadas')); }
    else if (r === 'denied') toast(t('Has bloqueado las notificaciones en el navegador'));
    else if (r === 'server-disabled') toast(t('El servidor aún no tiene notificaciones push configuradas'));
    else toast(t('Este dispositivo no admite notificaciones push'));
  };

  const exportData = async () => {
    const data = await api<unknown>('/me/export');
    saveTextFile('econsultor-export.json', 'application/json', JSON.stringify(data, null, 2));
  };

  const { section } = useParams();
  useEffect(() => { window.scrollTo(0, 0); }, [section]);

  const sections: Section[] = [
    { id: 'general', icon: 'gear', title: tk('Interfaz, idioma y perfil'), hint: tk('Tipo de interfaz, idioma, moneda y tema'), multi: true, body: (
      <>
        <Card title={t('Interfaz')} subtitle={t('Sencilla: lo esencial, con pocos gráficos. Profesional: el análisis completo.')}>
          <ModeSwitch />
        </Card>

        <Card title={t('Idioma')} subtitle={t('El idioma de la app y de los consejos. Se guarda en tu cuenta.')}>
          <div className="setting"><div><b>{t('Idioma de la app')}</b></div><LanguagePicker onSaved={(u) => setUser(u as PublicUser)} /></div>
        </Card>

        <Card title={t('Perfil')}>
          <div className="field">
            <label htmlFor="dn">{t('Nombre')}</label>
            <input id="dn" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== user.displayName && patch({ displayName: name.trim() })} />
          </div>
          <div className="field">
            <label htmlFor="cur">{t('Moneda')}</label>
            <select id="cur" className="input" value={user.currency} onChange={(e) => patch({ currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="hint">{t('Cambiar la moneda no convierte importes ya anotados.')}</span>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="lbl">{t('Apariencia')}</span>
            <div className="segmented" role="group" aria-label={t('Tema')}>
              {([['system', tk('Sistema')], ['light', tk('Claro')], ['dark', tk('Oscuro')]] as const).map(([k, l]) => (
                <button key={k} aria-pressed={theme === k} onClick={() => { setTheme(k); applyTheme(k); }}>{t(l)}</button>
              ))}
            </div>
          </div>
        </Card>
      </>
    ) },
    { id: 'suscripcion', icon: 'spark', title: tk('Suscripción'), hint: tk('Tu plan, el pago y cómo cancelar'), body: <SubscriptionCard /> },
    { id: 'captura', icon: 'bolt', title: tk('Captura de pagos'), hint: tk('Apple Pay y avisos del banco entran solos, sin conectar nada'), body: <CaptureCard /> },
    { id: 'periodicos', icon: 'repeat', title: tk('Gastos periódicos'), hint: tk('Alquiler, transporte, suscripciones, nómina…'), body: <RecurringCard /> },
    { id: 'categorias', icon: 'list', title: tk('Categorías'), hint: tk('Crea las tuyas, cambia nombres u oculta las que no uses'), body: <CategoriesCard /> },
    { id: 'informe', icon: 'chart', title: tk('Informe mensual'), hint: tk('Descarga un PDF con el análisis de cada mes'), body: <ReportCard /> },
    { id: 'avisos', icon: 'bell', title: tk('Recordatorio diario'), hint: tk('Un aviso para que no se te olvide anotar'), body: (
      <Card title={t('Recordatorio diario')} subtitle={t('Un aviso al final del día para anotar tus movimientos. Solo si aún no has anotado nada.')}>
          <div className="setting">
            <div><b>{t('Recordarme cada día')}</b></div>
            <Switch label={t('Recordatorio diario')} checked={user.reminderEnabled} onChange={(v) => patch({ reminderEnabled: v })} />
          </div>
          <div className="setting">
            <div><b>{t('Hora del aviso')}</b><p>{t('En tu hora local ({tz}).', { tz: user.timezone })}</p></div>
            <input className="input" type="time" aria-label={t('Hora del recordatorio')} style={{ width: 130 }} value={user.reminderTime} onChange={(e) => e.target.value && patch({ reminderTime: e.target.value })} />
          </div>
          {isAndroidApp() ? (
            <div className="setting"><div><b>{t('Aviso en este teléfono')}</b><p>{t('La app de Android programa el aviso en tu teléfono: llega aunque la app esté cerrada.')}</p></div></div>
          ) : (
          <div className="setting">
            <div>
              <b>{t('Notificaciones en este dispositivo')}</b>
              {isIOS() && !isStandalone()
                ? <p>{t('En iPhone: pulsa Compartir y «Añadir a pantalla de inicio»; después abre EConsultor desde ahí y activa los avisos.')}</p>
                : !pushSupported() ? <p>{t('Este navegador no admite notificaciones push.')}</p> : <p>{t('Necesitas permitirlas en el navegador.')}</p>}
            </div>
            <Switch label={t('Notificaciones push')} checked={pushOn} onChange={togglePush} />
          </div>
          )}
        </Card>
    ) },
    { id: 'seguridad', icon: 'shield', title: tk('Seguridad'), hint: tk('Verificación en dos pasos, huella y sesiones'), body: <Security /> },
    { id: 'datos', icon: 'upload', title: tk('Tus datos'), hint: tk('Importar extractos, exportar o borrar'), body: (
      <Card title={t('Tus datos')} subtitle={t('Son tuyos: puedes llevártelos o borrarlos cuando quieras.')}>
          <div className="setting"><div><b>{t('Importar extractos bancarios')}</b><p>{t('Sube el CSV o el PDF de tu banco y rellenamos tus movimientos y tu perfil.')}</p></div><button className="btn" onClick={openImport}><Icon name="upload" size={18} />{t('Importar')}</button></div>
          <StatementReminderSetting />
          <div className="setting"><div><b>{t('Exportar mis datos')}</b><p>{t('Un archivo JSON con tus movimientos y ajustes.')}</p></div><button className="btn" onClick={exportData}><Icon name="download" size={18} />{t('Exportar')}</button></div>
          <DangerZone onDone={() => invalidate()} />
        </Card>
    ) },
    { id: 'ayuda', icon: 'help', title: tk('Ayuda y novedades'), hint: tk('Guía, novedades y reportar un fallo'), body: (
      <Card title={t('Ayuda')} subtitle={t('Guías, trucos y respuestas. Búscalas cuando las necesites.')}>
          <div className="setting"><div><b>{t('Ayuda y tutorial')}</b><p>{t('Cómo usar la app a diario o con un extracto mensual, qué significa cada gráfica…')}</p></div><Link className="btn" to="/ayuda"><Icon name="help" size={18} />{t('Abrir')}</Link></div>
          <div className="setting"><div><b>{t('Novedades')}</b><p>{t('Qué ha cambiado en la app. Versión {version}.', { version: __APP_VERSION__ })}</p></div><button className="btn" onClick={openWhatsNew}><Icon name="spark" size={18} />{t('Ver')}</button></div>
          <div className="setting"><div><b>{t('Reportar un fallo o una idea')}</b><p>{t('También tienes un icono discreto arriba a la derecha en cualquier pantalla.')}</p></div><button className="btn" onClick={openReport}><Icon name="bug" size={18} />{t('Reportar')}</button></div>
          {!isAndroidApp() && cfg?.apkUrl && (
            <div className="setting"><div><b>{t('App para Android')}</b><p>{t('Con el aviso diario nativo.')}</p></div><a className="btn" href={cfg.apkUrl}><Icon name="phone" size={18} />{t('Descargar')}</a></div>
          )}
        </Card>
    ) },
    ...(cfg?.demo ? [{ id: 'demo', icon: 'spark' as const, title: tk('Modo demostración'), hint: tk('Solo visible en desarrollo.'), body: (
      <Card title={t('Modo demostración')} subtitle={t('Solo visible en desarrollo.')}>
            <div className="setting">
              <div><b>{t('Plan')}</b><p>{t('Ahora: {plan}. Premium añade la IA: consejos escritos por IA y Ian, tu asistente.', { plan: user.plan === 'premium' ? t('Premium') : t('Gratis') })}</p></div>
              <button className="btn" onClick={async () => setUser(await api<PublicUser>('/dev/plan', { method: 'POST', json: { plan: user.plan === 'premium' ? 'free' : 'premium' } }))}>
                {t('Cambiar a {plan}', { plan: user.plan === 'premium' ? t('Gratis') : t('Premium') })}
              </button>
            </div>
          </Card>
    ) }] : []),
  ];

  const current = sections.find((x) => x.id === section);
  if (section && !current) return <Navigate to="/ajustes" replace />;

  if (current) {
    return (
      <div>
        <header className="page-head subpage-head">
          <Link to="/ajustes" className="icon-btn" aria-label={t('Volver a Ajustes')}><Icon name="left" size={20} /></Link>
          <h1>{t(current.title)}</h1>
        </header>
        <div className={`stack ${current.multi ? '' : 'sub-single'}`}>{current.body}</div>
      </div>
    );
  }

  return (
    <div>
      <header className="page-head"><h1>{t('Ajustes')}</h1></header>
      <div className="stack">
        <nav className="menu card" aria-label={t('Ajustes')}>
          {sections.map((x) => (
            <Link key={x.id} to={`/ajustes/${x.id}`} className="menu-row">
              <span className="tile"><Icon name={x.icon} /></span>
              <span className="menu-text"><b>{t(x.title)}</b><small>{t(x.hint)}</small></span>
              <Icon name="right" size={18} />
            </Link>
          ))}
        </nav>

        <button className="btn btn-block" onClick={logout}><Icon name="logout" size={18} />{t('Cerrar sesión')}</button>
        <p className="hint" style={{ textAlign: 'center' }}>{user.email}</p>
      </div>
    </div>
  );
}

function Security() {
  const user = useUser();
  const { setUser, logout } = useAuth();
  const { toast } = useShell();
  const [step, setStep] = useState<'idle' | 'setup' | 'codes' | 'disable'>('idle');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const events = useQuery({ queryKey: ['security'], queryFn: () => api<{ events: { type: string; at: string; ip?: string }[] }>('/me/security') });

  const start = async () => {
    setErr('');
    const r = await api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', { method: 'POST' });
    setSecret(r.secret);
    setQr(await QRCode.toDataURL(r.otpauthUri, { margin: 0, width: 192, errorCorrectionLevel: 'M' }));
    setCode('');
    setStep('setup');
  };
  const confirm = async () => {
    try {
      const r = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', json: { code } });
      setCodes(r.recoveryCodes);
      setUser({ ...user, mfaEnabled: true });
      setStep('codes');
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Error')); }
  };
  const disable = async () => {
    try {
      await api('/auth/mfa/disable', { method: 'POST', json: { code, password: password || undefined } });
      setUser({ ...user, mfaEnabled: false });
      setStep('idle'); setCode(''); setPassword('');
      toast(t('Verificación en dos pasos desactivada'));
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Error')); }
  };
  const logoutAll = async () => {
    await api('/auth/logout-all', { method: 'POST' });
    await logout();
  };

  const [pkStatus, setPkStatus] = useState<PasskeyStatus | null>(null);
  const [pkBusy, setPkBusy] = useState(false);
  useEffect(() => { passkeyStatus().then(setPkStatus); }, []);
  const hereId = thisDeviceKeyId();
  const refreshMe = async () => setUser(await api<PublicUser>('/me'));
  const addPasskey = async () => {
    setPkBusy(true);
    try { await registerPasskey(); await refreshMe(); toast(t('Huella activada en este dispositivo')); }
    catch (e) { const m = e instanceof ApiError ? e.message : passkeyMessage(e); if (m) toast(m); }
    finally { setPkBusy(false); }
  };
  const removePasskey = async (id: string, kind: 'passkey' | 'app') => {
    try {
      await removeKey(id, kind);
      await refreshMe();
      toast(t('Dispositivo eliminado'));
    } catch (e) { toast((e as Error).message); }
  };
  const setKeep = async (v: boolean) => {
    try { setUser(await api<PublicUser>('/me/settings', { method: 'PATCH', json: { keepSignedIn: v } })); toast(v ? t('Mantendremos tu sesión abierta') : t('La sesión se cerrará tras 10 minutos sin actividad')); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <Card title={t('Seguridad')} subtitle={t('Protege tu información financiera.')}>
      {step === 'idle' && (
        <div className="setting">
          <div>
            <b>{t('Verificación en dos pasos')} {user.mfaEnabled && <span className="badge premium" style={{ marginLeft: 6 }}>{t('Activa')}</span>}</b>
            <p>{t('Un código de tu app autenticadora (Google Authenticator, 1Password, Authy…) además de la contraseña.')}</p>
          </div>
          {user.mfaEnabled
            ? <button className="btn" onClick={() => { setStep('disable'); setErr(''); setCode(''); }}>{t('Desactivar')}</button>
            : <button className="btn btn-primary" onClick={start}><Icon name="shield" size={18} />{t('Activar')}</button>}
        </div>
      )}

      {step === 'setup' && (
        <div className="stack">
          <p className="sub">{t('1. Escanea este código con tu app autenticadora. 2. Escribe el código de 6 dígitos que te muestre.')}</p>
          <div className="qr"><img src={qr} width={192} height={192} alt={t('Código QR para la app autenticadora')} /></div>
          <p className="hint" style={{ textAlign: 'center' }}>{t('¿No puedes escanear? Introduce esta clave:')} <code style={{ userSelect: 'all' }}>{secret}</code></p>
          <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label={t('Código de 6 dígitos')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {err && <p className="error" role="alert">{err}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" disabled={code.length !== 6} onClick={confirm}>{t('Activar')}</button>
            <button className="btn btn-ghost" onClick={() => setStep('idle')}>{t('Cancelar')}</button>
          </div>
        </div>
      )}

      {step === 'codes' && (
        <div className="stack">
          <p><b>{t('Guarda estos códigos de recuperación.')}</b> <span className="sub">{t('Cada uno sirve una sola vez si pierdes el acceso a tu app. No volverán a mostrarse.')}</span></p>
          <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); toast(t('Copiados')); }}><Icon name="copy" size={18} />{t('Copiar')}</button>
            <button className="btn btn-primary" onClick={() => setStep('idle')}>{t('Los he guardado')}</button>
          </div>
        </div>
      )}

      {step === 'disable' && (
        <div className="stack">
          {user.hasPassword && (
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="pw">{t('Contraseña')}</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          )}
          <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label={t('Código de 6 dígitos')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {err && <p className="error" role="alert">{err}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-danger" disabled={code.length !== 6} onClick={disable}>{t('Desactivar verificación')}</button>
            <button className="btn btn-ghost" onClick={() => setStep('idle')}>{t('Cancelar')}</button>
          </div>
        </div>
      )}

      <div className="setting">
        <div>
          <b>{t('Mantener conectado')}</b>
          <p>{user.keepSignedIn ? t('Tu sesión no se cierra sola. Hazlo solo en dispositivos tuyos y con bloqueo de pantalla.') : t('Por seguridad, cerramos tu sesión tras 10 minutos sin actividad.')}</p>
        </div>
        <Switch label={t('Mantener conectado')} checked={user.keepSignedIn} onChange={setKeep} />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="setting">
          <div>
            <b>{t('Entrar con huella')}</b>
            <p>
              {pkStatus && !pkStatus.ok
                ? statusMessage(pkStatus.reason)
                : t('Usa la huella (o la cara o el PIN) de este dispositivo en lugar de la contraseña. La huella nunca sale del dispositivo.')}
            </p>
          </div>
          {pkStatus?.ok && <button className="btn btn-primary" disabled={pkBusy} onClick={addPasskey}><Icon name="fingerprint" size={18} />{t('Activar aquí')}</button>}
        </div>
        {(user.passkeys ?? []).map((k) => (
          <div className="event" key={k.id}>
            <span><Icon name="fingerprint" size={16} /> {k.name}{hereId === k.id && <> · <b>{t('este dispositivo')}</b></>} <span className="muted">· {t('desde {date}', { date: new Date(k.createdAt).toLocaleDateString(locale(), { dateStyle: 'medium' }) })}</span></span>
            <button className="chip-btn" onClick={() => removePasskey(k.id, k.kind)}>{t('Quitar')}</button>
          </div>
        ))}
      </div>

      <div className="setting"><div><b>{t('Cerrar sesión en todos los dispositivos')}</b><p>{t('Útil si pierdes un teléfono u ordenador.')}</p></div><button className="btn" onClick={logoutAll}>{t('Cerrar todas')}</button></div>

      {events.data && events.data.events.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="sub" style={{ cursor: 'pointer', padding: '8px 0' }}>{t('Actividad reciente')}</summary>
          {events.data.events.map((e, i) => (
            <div className="event" key={i}>
              <span>{EVENT_LABEL[e.type] ? t(EVENT_LABEL[e.type]!) : e.type}</span>
              <span className="muted num">{new Date(e.at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</span>
            </div>
          ))}
        </details>
      )}
    </Card>
  );
}

function DangerZone({ onDone }: { onDone: () => void }) {
  const user = useUser();
  const { logout } = useAuth();
  const { toast } = useShell();
  const [mode, setMode] = useState<'idle' | 'wipe' | 'delete'>('idle');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');

  const wipe = async () => { await api('/me/data', { method: 'DELETE' }); onDone(); setMode('idle'); toast(t('Movimientos borrados')); };
  const del = async () => {
    try {
      await api('/me', { method: 'DELETE', json: { confirmEmail: email, password: pw || undefined } });
      await logout();
    } catch (e) { setErr(e instanceof ApiError ? e.message : t('Error')); }
  };

  if (mode === 'idle') {
    return (
      <>
        <div className="setting"><div><b>{t('Borrar todos mis movimientos')}</b><p>{t('Conserva tu cuenta.')}</p></div><button className="btn btn-danger" onClick={() => setMode('wipe')}>{t('Borrar')}</button></div>
        <div className="setting"><div><b>{t('Eliminar mi cuenta')}</b><p>{t('Borra tu cuenta y todos tus datos de forma definitiva.')}</p></div><button className="btn btn-danger" onClick={() => setMode('delete')}>{t('Eliminar')}</button></div>
      </>
    );
  }
  if (mode === 'wipe') {
    return (
      <div className="stack" style={{ paddingTop: 10 }}>
        <p>{t('Se borrarán todos tus movimientos. Esta acción no se puede deshacer.')}</p>
        <div style={{ display: 'flex', gap: 10 }}><button className="btn btn-danger" onClick={wipe}>{t('Sí, borrar todo')}</button><button className="btn btn-ghost" onClick={() => setMode('idle')}>{t('Cancelar')}</button></div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ paddingTop: 10 }}>
      <p>{user.hasPassword ? t('Para confirmar, escribe tu email ({email}) y tu contraseña.', { email: user.email }) : t('Para confirmar, escribe tu email ({email}).', { email: user.email })}</p>
      <input className="input" type="email" aria-label={t('Email')} value={email} onChange={(e) => setEmail(e.target.value)} />
      {user.hasPassword && <input className="input" type="password" aria-label={t('Contraseña')} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
      {err && <p className="error" role="alert">{err}</p>}
      <div style={{ display: 'flex', gap: 10 }}><button className="btn btn-danger" onClick={del}>{t('Eliminar cuenta definitivamente')}</button><button className="btn btn-ghost" onClick={() => setMode('idle')}>{t('Cancelar')}</button></div>
    </div>
  );
}

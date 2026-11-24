import type { PublicUser } from '@econsultor/shared';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { ModeSwitch } from '../components/ModeSwitch';
import { useShell } from '../components/Shell';
import { Card, Switch } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { useAppConfig, useInvalidateData } from '../lib/queries';
import { disablePush, enablePush, hasPushSubscription, isIOS, isStandalone, pushSupported } from '../lib/push';
import { applyTheme, getThemePref, type ThemePref } from '../lib/theme';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL'];
const EVENT_LABEL: Record<string, string> = {
  login: 'Inicio de sesión', login_failed: 'Intento de acceso fallido', register: 'Cuenta creada', mfa_enabled: 'Verificación en dos pasos activada',
  mfa_disabled: 'Verificación en dos pasos desactivada', mfa_failed: 'Código de verificación incorrecto', recovery_code_used: 'Código de recuperación usado',
  logout_all: 'Sesiones cerradas en todos los dispositivos', refresh_reuse_detected: 'Sesión sospechosa bloqueada',
};

export function Settings() {
  const user = useUser();
  const { setUser, logout } = useAuth();
  const { toast, openImport } = useShell();
  const { data: cfg } = useAppConfig();
  const invalidate = useInvalidateData();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const [pushOn, setPushOn] = useState(false);
  const [name, setName] = useState(user.displayName);

  useEffect(() => { hasPushSubscription().then(setPushOn); }, []);

  const patch = async (p: Partial<{ displayName: string; currency: string; reminderEnabled: boolean; reminderTime: string }>) => {
    try { setUser(await api<PublicUser>('/me/settings', { method: 'PATCH', json: p })); toast('Guardado'); }
    catch (e) { toast((e as Error).message); }
  };

  const togglePush = async () => {
    if (pushOn) { await disablePush(); setPushOn(false); return toast('Notificaciones desactivadas'); }
    const r = await enablePush();
    if (r === 'ok') { setPushOn(true); toast('Notificaciones activadas'); }
    else if (r === 'denied') toast('Has bloqueado las notificaciones en el navegador');
    else if (r === 'server-disabled') toast('El servidor aún no tiene notificaciones push configuradas');
    else toast('Este dispositivo no admite notificaciones push');
  };

  const exportData = async () => {
    const data = await api<unknown>('/me/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'econsultor-export.json' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <header className="page-head"><h1>Ajustes</h1></header>
      <div className="stack">
        <Card title="Interfaz" subtitle="Sencilla: lo esencial, con pocos gráficos. Profesional: el análisis completo.">
          <ModeSwitch />
        </Card>

        <Card title="Perfil">
          <div className="field">
            <label htmlFor="dn">Nombre</label>
            <input id="dn" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== user.displayName && patch({ displayName: name.trim() })} />
          </div>
          <div className="field">
            <label htmlFor="cur">Moneda</label>
            <select id="cur" className="input" value={user.currency} onChange={(e) => patch({ currency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <span className="hint">Cambiar la moneda no convierte importes ya anotados.</span>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <span className="lbl">Apariencia</span>
            <div className="segmented" role="group" aria-label="Tema">
              {([['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']] as const).map(([k, l]) => (
                <button key={k} aria-pressed={theme === k} onClick={() => { setTheme(k); applyTheme(k); }}>{l}</button>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Recordatorio diario" subtitle="Un aviso al final del día para anotar tus movimientos. Solo si aún no has anotado nada.">
          <div className="setting">
            <div><b>Recordarme cada día</b></div>
            <Switch label="Recordatorio diario" checked={user.reminderEnabled} onChange={(v) => patch({ reminderEnabled: v })} />
          </div>
          <div className="setting">
            <div><b>Hora del aviso</b><p>En tu hora local ({user.timezone}).</p></div>
            <input className="input" type="time" aria-label="Hora del recordatorio" style={{ width: 130 }} value={user.reminderTime} onChange={(e) => e.target.value && patch({ reminderTime: e.target.value })} />
          </div>
          <div className="setting">
            <div>
              <b>Notificaciones en este dispositivo</b>
              {isIOS() && !isStandalone()
                ? <p>En iPhone: pulsa Compartir y «Añadir a pantalla de inicio»; después abre EConsultor desde ahí y activa los avisos.</p>
                : !pushSupported() ? <p>Este navegador no admite notificaciones push.</p> : <p>Necesitas permitirlas en el navegador.</p>}
            </div>
            <Switch label="Notificaciones push" checked={pushOn} onChange={togglePush} />
          </div>
        </Card>

        <Security />

        <Card title="Tus datos" subtitle="Son tuyos: puedes llevártelos o borrarlos cuando quieras.">
          <div className="setting"><div><b>Importar extractos bancarios</b><p>Sube el CSV o el PDF de tu banco y rellenamos tus movimientos y tu perfil.</p></div><button className="btn" onClick={openImport}><Icon name="upload" size={18} />Importar</button></div>
          <div className="setting"><div><b>Exportar mis datos</b><p>Un archivo JSON con tus movimientos y ajustes.</p></div><button className="btn" onClick={exportData}><Icon name="download" size={18} />Exportar</button></div>
          <DangerZone onDone={() => invalidate()} />
        </Card>

        {cfg?.demo && (
          <Card title="Modo demostración" subtitle="Solo visible en desarrollo.">
            <div className="setting">
              <div><b>Plan</b><p>Ahora: {user.plan === 'premium' ? 'Premium' : 'Gratis'}. Premium desbloquea todos los consejos y la IA.</p></div>
              <button className="btn" onClick={async () => setUser(await api<PublicUser>('/dev/plan', { method: 'POST', json: { plan: user.plan === 'premium' ? 'free' : 'premium' } }))}>
                Cambiar a {user.plan === 'premium' ? 'Gratis' : 'Premium'}
              </button>
            </div>
          </Card>
        )}

        <button className="btn btn-block" onClick={logout}><Icon name="logout" size={18} />Cerrar sesión</button>
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
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  };
  const disable = async () => {
    try {
      await api('/auth/mfa/disable', { method: 'POST', json: { code, password: password || undefined } });
      setUser({ ...user, mfaEnabled: false });
      setStep('idle'); setCode(''); setPassword('');
      toast('Verificación en dos pasos desactivada');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  };
  const logoutAll = async () => {
    await api('/auth/logout-all', { method: 'POST' });
    await logout();
  };

  return (
    <Card title="Seguridad" subtitle="Protege tu información financiera.">
      {step === 'idle' && (
        <div className="setting">
          <div>
            <b>Verificación en dos pasos {user.mfaEnabled && <span className="badge premium" style={{ marginLeft: 6 }}>Activa</span>}</b>
            <p>Un código de tu app autenticadora (Google Authenticator, 1Password, Authy…) además de la contraseña.</p>
          </div>
          {user.mfaEnabled
            ? <button className="btn" onClick={() => { setStep('disable'); setErr(''); setCode(''); }}>Desactivar</button>
            : <button className="btn btn-primary" onClick={start}><Icon name="shield" size={18} />Activar</button>}
        </div>
      )}

      {step === 'setup' && (
        <div className="stack">
          <p className="sub">1. Escanea este código con tu app autenticadora. 2. Escribe el código de 6 dígitos que te muestre.</p>
          <div className="qr"><img src={qr} width={192} height={192} alt="Código QR para la app autenticadora" /></div>
          <p className="hint" style={{ textAlign: 'center' }}>¿No puedes escanear? Introduce esta clave: <code style={{ userSelect: 'all' }}>{secret}</code></p>
          <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label="Código de 6 dígitos" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {err && <p className="error" role="alert">{err}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" disabled={code.length !== 6} onClick={confirm}>Activar</button>
            <button className="btn btn-ghost" onClick={() => setStep('idle')}>Cancelar</button>
          </div>
        </div>
      )}

      {step === 'codes' && (
        <div className="stack">
          <p><b>Guarda estos códigos de recuperación.</b> <span className="sub">Cada uno sirve una sola vez si pierdes el acceso a tu app. No volverán a mostrarse.</span></p>
          <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); toast('Copiados'); }}><Icon name="copy" size={18} />Copiar</button>
            <button className="btn btn-primary" onClick={() => setStep('idle')}>Los he guardado</button>
          </div>
        </div>
      )}

      {step === 'disable' && (
        <div className="stack">
          {user.hasPassword && (
            <div className="field" style={{ marginBottom: 0 }}><label htmlFor="pw">Contraseña</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          )}
          <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label="Código de 6 dígitos" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          {err && <p className="error" role="alert">{err}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-danger" disabled={code.length !== 6} onClick={disable}>Desactivar verificación</button>
            <button className="btn btn-ghost" onClick={() => setStep('idle')}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="setting"><div><b>Cerrar sesión en todos los dispositivos</b><p>Útil si pierdes un teléfono u ordenador.</p></div><button className="btn" onClick={logoutAll}>Cerrar todas</button></div>

      {events.data && events.data.events.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="sub" style={{ cursor: 'pointer', padding: '8px 0' }}>Actividad reciente</summary>
          {events.data.events.map((e, i) => (
            <div className="event" key={i}>
              <span>{EVENT_LABEL[e.type] ?? e.type}</span>
              <span className="muted num">{new Date(e.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
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

  const wipe = async () => { await api('/me/data', { method: 'DELETE' }); onDone(); setMode('idle'); toast('Movimientos borrados'); };
  const del = async () => {
    try {
      await api('/me', { method: 'DELETE', json: { confirmEmail: email, password: pw || undefined } });
      await logout();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  };

  if (mode === 'idle') {
    return (
      <>
        <div className="setting"><div><b>Borrar todos mis movimientos</b><p>Conserva tu cuenta.</p></div><button className="btn btn-danger" onClick={() => setMode('wipe')}>Borrar</button></div>
        <div className="setting"><div><b>Eliminar mi cuenta</b><p>Borra tu cuenta y todos tus datos de forma definitiva.</p></div><button className="btn btn-danger" onClick={() => setMode('delete')}>Eliminar</button></div>
      </>
    );
  }
  if (mode === 'wipe') {
    return (
      <div className="stack" style={{ paddingTop: 10 }}>
        <p>Se borrarán todos tus movimientos. Esta acción no se puede deshacer.</p>
        <div style={{ display: 'flex', gap: 10 }}><button className="btn btn-danger" onClick={wipe}>Sí, borrar todo</button><button className="btn btn-ghost" onClick={() => setMode('idle')}>Cancelar</button></div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ paddingTop: 10 }}>
      <p>Para confirmar, escribe tu email ({user.email}){user.hasPassword ? ' y tu contraseña' : ''}.</p>
      <input className="input" type="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {user.hasPassword && <input className="input" type="password" aria-label="Contraseña" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
      {err && <p className="error" role="alert">{err}</p>}
      <div style={{ display: 'flex', gap: 10 }}><button className="btn btn-danger" onClick={del}>Eliminar cuenta definitivamente</button><button className="btn btn-ghost" onClick={() => setMode('idle')}>Cancelar</button></div>
    </div>
  );
}

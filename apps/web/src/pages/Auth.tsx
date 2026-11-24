import { useState, type FormEvent } from 'react';
import { ApiError, authApi } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Cintas de color: el motivo gráfico de la marca (flujo de dinero), con deriva lenta. */
function Ribbons() {
  return (
    <svg className="ribbons" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="r1" x1="0" x2="1"><stop offset="0" stopColor="#3987e5" stopOpacity="0.0" /><stop offset="0.5" stopColor="#3987e5" stopOpacity="0.55" /><stop offset="1" stopColor="#9085e9" stopOpacity="0.15" /></linearGradient>
        <linearGradient id="r2" x1="0" x2="1"><stop offset="0" stopColor="#199e70" stopOpacity="0.0" /><stop offset="0.5" stopColor="#199e70" stopOpacity="0.5" /><stop offset="1" stopColor="#3987e5" stopOpacity="0.15" /></linearGradient>
        <linearGradient id="r3" x1="0" x2="1"><stop offset="0" stopColor="#9085e9" stopOpacity="0.0" /><stop offset="0.55" stopColor="#d55181" stopOpacity="0.4" /><stop offset="1" stopColor="#d95926" stopOpacity="0.12" /></linearGradient>
      </defs>
      <g className="ribbon-flow" fill="none" strokeLinecap="round">
        <path d="M-40 420 C 160 420, 240 250, 420 260 S 700 130, 860 90" stroke="url(#r1)" strokeWidth="64" />
        <path d="M-40 500 C 200 520, 280 340, 460 350 S 720 250, 860 210" stroke="url(#r2)" strokeWidth="44" style={{ animationDelay: '-4s' }} />
        <path d="M-40 330 C 120 300, 260 400, 440 170 S 700 60, 860 20" stroke="url(#r3)" strokeWidth="26" />
      </g>
    </svg>
  );
}

export function Auth() {
  const { accept } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo conectar con el servidor'); } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = mode === 'login' ? await authApi.login(email, password) : await authApi.register({ email, password, displayName: name });
      const token = accept(res);
      if (token) setMfaToken(token);
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await authApi.mfa(mfaToken!, useRecovery ? { recoveryCode: code } : { code });
      accept(res);
    });
  };

  return (
    <div className="auth">
      <div className="auth-art">
        <Ribbons />
        <h2>Tu dinero, a la vista.</h2>
        <p>Anota en segundos, entiende a dónde va cada euro y recibe consejos pensados para tus números.</p>
      </div>

      <div className="auth-form">
        {mfaToken ? (
          <form onSubmit={verify}>
            <h1>Verificación en dos pasos</h1>
            <p className="sub" style={{ marginBottom: 18 }}>{useRecovery ? 'Escribe uno de tus códigos de recuperación.' : 'Escribe el código de 6 dígitos de tu app autenticadora.'}</p>
            <div className="field">
              <input
                className={`input ${useRecovery ? '' : 'code-input'}`} autoFocus inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code"
                maxLength={useRecovery ? 16 : 6} placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'} aria-label="Código"
                value={code} onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || (useRecovery ? code.length < 8 : code.length !== 6)}>Entrar</button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(''); }}>
              {useRecovery ? 'Usar el código de la app' : 'Usar un código de recuperación'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => { setMfaToken(null); setCode(''); setError(''); }}>Volver</button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <h1>{mode === 'login' ? 'Entrar' : 'Crear tu cuenta'}</h1>
            {mode === 'register' && (
              <div className="field"><label htmlFor="name">Nombre</label><input id="name" className="input" autoComplete="given-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
            )}
            <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field">
              <label htmlFor="pw">Contraseña</label>
              <input id="pw" className="input" type="password" required minLength={mode === 'register' ? 10 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
              {mode === 'register' && <span className="hint">Mínimo 10 caracteres. Una frase larga es mejor que una palabra con símbolos.</span>}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
              {mode === 'login' ? 'No tengo cuenta · Crear una' : 'Ya tengo cuenta · Entrar'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

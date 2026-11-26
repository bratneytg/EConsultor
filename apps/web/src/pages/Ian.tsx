import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IAN_MAX_CHARS, IAN_MAX_MESSAGES, IAN_MAX_REPLY_CHARS, type IanReply } from '@econsultor/shared';
import { Icon } from '../components/Icon';
import { PremiumNudge } from '../components/Premium';
import { api } from '../lib/api';
import { useUser } from '../lib/auth';
import { t, tk } from '../lib/i18n';
import { useIanStatus } from '../lib/queries';

interface Msg { role: 'user' | 'assistant'; content: string; error?: boolean }

const SUGGESTIONS = [
  tk('¿En qué he gastado más este mes?'),
  tk('¿Cómo voy respecto al mes pasado?'),
  tk('¿Qué cargos se repiten cada mes?'),
  tk('¿Cuánto me sobrará a fin de mes?'),
];

function Avatar({ size = 36 }: { size?: number }) {
  return <span className="ian-avatar" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden="true">I</span>;
}

/** Lo que ve una cuenta gratuita: qué es Ian, con un ejemplo, y la invitación a Premium. */
function IanTeaser() {
  return (
    <>
      <section className="card ian-intro">
        <Avatar size={52} />
        <div>
          <h2>{t('Ian es parte de Premium')}</h2>
          <p className="sub">{t('Pregúntale por tus gastos como se lo preguntarías a una persona y te responde con tus cifras reales, sin hojas de cálculo.')}</p>
        </div>
      </section>

      <section className="card" aria-labelledby="ian-ex">
        <div className="card-head"><div><h2 id="ian-ex">{t('Así contesta')}</h2><p>{t('Ejemplo ilustrativo; Ian usará tus datos reales.')}</p></div></div>
        <div className="ian-thread" aria-hidden="false">
          <div className="ian-msg me"><p>{t('¿Cuánto he gastado en comer fuera este mes?')}</p></div>
          <div className="ian-msg ian"><Avatar size={28} /><p>{t('Llevas 142 € entre restaurantes y comida a domicilio, 38 € más que el mes pasado. Casi la mitad fue en viernes y sábado.')}</p></div>
          <div className="ian-msg me"><p>{t('¿Y si lo bajo a la mitad?')}</p></div>
          <div className="ian-msg ian"><Avatar size={28} /><p>{t('Ahorrarías unos 70 € al mes, unos 850 € al año. Con eso cubrirías casi dos meses de tu seguro.')}</p></div>
        </div>
      </section>

      <PremiumNudge variant="panel" title={t('Habla con Ian con Premium')} text={t('Ian lee lo que has anotado y responde a lo que le preguntes. Incluye también los consejos escritos por IA.')} />
    </>
  );
}

export function Ian() {
  const user = useUser();
  const nav = useNavigate();
  const qc = useQueryClient();
  const premium = user.plan === 'premium';
  const { data: status } = useIanStatus();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const remaining = left ?? status?.remaining ?? null;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, busy]);

  const ask = async (history: Msg[]) => {
    setBusy(true);
    try {
      const sent = history.slice(-IAN_MAX_MESSAGES).map((m) => ({ role: m.role, content: m.role === 'user' ? m.content : m.content.slice(0, IAN_MAX_REPLY_CHARS) }));
      const r = await api<IanReply>('/ian/chat', { method: 'POST', json: { messages: sent } });
      setMsgs([...history, { role: 'assistant', content: r.reply }]);
      setLeft(r.remaining);
    } catch (e) {
      setMsgs([...history, { role: 'assistant', content: (e as Error).message || t('Ian no ha podido responder ahora. Inténtalo de nuevo en un momento.'), error: true }]);
      void qc.invalidateQueries({ queryKey: ['ian'] });
    } finally { setBusy(false); }
  };

  const send = (q?: string) => {
    const content = (q ?? text).trim().slice(0, IAN_MAX_CHARS);
    if (!content || busy) return;
    const history: Msg[] = [...msgs.filter((m) => !m.error), { role: 'user', content }];
    setMsgs(history);
    setText('');
    void ask(history);
  };
  const retry = () => { const history = msgs.filter((m) => !m.error); if (history.length && !busy) void ask(history); };
  const reset = () => { setMsgs([]); setText(''); areaRef.current?.focus(); };

  const head = (
    <header className="page-head subpage-head">
      <button className="icon-btn" aria-label={t('Volver')} onClick={() => (window.history.length > 1 ? nav(-1) : nav('/consejos'))}><Icon name="left" size={20} /></button>
      <Avatar />
      <div className="ian-title">
        <h1>{t('Ian')}</h1>
        <p className="muted">{t('Tu asistente con IA')}</p>
      </div>
      {premium && msgs.length > 0 && <button className="chip-btn" onClick={reset}>{t('Nueva conversación')}</button>}
    </header>
  );

  if (!premium) return <div className="ian-page">{head}<IanTeaser /></div>;

  if (status && !status.available) {
    return (
      <div className="ian-page">
        {head}
        <div className="ai-consent" role="status">
          <b><Icon name="warn" size={16} /> {t('Ian no está disponible')}</b>
          <p>{t('La IA no está activada en tu servidor: falta la clave de Anthropic. En el servidor ejecuta «bash scripts/servidor.sh ia» y pega la clave cuando te la pida.')}</p>
        </div>
      </div>
    );
  }

  const noneLeft = remaining !== null && remaining <= 0;

  return (
    <div className="ian-page">
      {head}

      <div className="ian-thread" role="log" aria-live="polite" aria-label={t('Conversación con Ian')}>
        {msgs.length === 0 && (
          <div className="ian-empty">
            <p className="sub">{t('Pregúntame lo que quieras sobre tus números: gastos, ingresos, categorías o cargos que se repiten. Te contesto con lo que has anotado.')}</p>
            <div className="ian-suggestions">
              {SUGGESTIONS.map((s) => <button key={s} className="chip-btn" disabled={busy || noneLeft} onClick={() => send(t(s))}>{t(s)}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ian-msg ${m.role === 'user' ? 'me' : 'ian'}${m.error ? ' err' : ''}`}>
            {m.role === 'assistant' && <Avatar size={28} />}
            <div>
              <p>{m.content}</p>
              {m.error && !busy && i === msgs.length - 1 && <button className="chip-btn" onClick={retry}><Icon name="refresh" size={14} /> {t('Reintentar')}</button>}
            </div>
          </div>
        ))}
        {busy && <div className="ian-msg ian" role="status"><Avatar size={28} /><p className="ian-typing" aria-label={t('Ian está pensando…')}><span /><span /><span /></p></div>}
        <div ref={endRef} />
      </div>

      <form className="ian-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="sr-only" htmlFor="ian-q">{t('Tu pregunta para Ian')}</label>
        <textarea
          id="ian-q" ref={areaRef} rows={1} value={text} maxLength={IAN_MAX_CHARS} disabled={noneLeft}
          placeholder={noneLeft ? t('Has llegado al límite de mensajes de hoy.') : t('Escribe tu pregunta…')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || noneLeft || !text.trim()} aria-label={t('Enviar')}><Icon name="right" size={18} /></button>
      </form>

      <p className="ian-fine">
        {t('Para contestar, Ian consulta tus movimientos en tu servidor y envía a la IA (Claude, de Anthropic) solo los datos que necesita para esa pregunta: importes, categorías y notas sin IBAN ni correos. La conversación no se guarda.')}{' '}
        {t('Ian no es un asesor financiero: es una ayuda para entender tus números.')}
        {remaining !== null && <> <span className="ian-left">{t('Mensajes que te quedan hoy: {n}', { n: remaining })}</span></>}
      </p>
      <p className="ian-fine"><Link to="/ayuda?a=ian">{t('Más sobre Ian en la Ayuda')}</Link></p>
    </div>
  );
}

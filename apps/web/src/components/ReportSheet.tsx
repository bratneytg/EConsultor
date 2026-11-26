import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { appVersion, platformName } from '../lib/native';
import { t, tk } from '../lib/i18n';

type Kind = 'bug' | 'idea' | 'other';
const KINDS: [Kind, string][] = [['bug', tk('Algo falla')], ['idea', tk('Una idea')], ['other', tk('Otra cosa')]];

export function ReportSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { pathname } = useLocation();
  const [kind, setKind] = useState<Kind>('bug');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setError(''); setBusy(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const send = async () => {
    if (message.trim().length < 5) return setError(t('Cuéntanos un poco más (mínimo 5 letras).'));
    setBusy(true);
    setError('');
    try {
      await api('/feedback', { method: 'POST', json: { kind, message: message.trim(), page: pathname, platform: platformName(), appVersion: appVersion() } });
      setMessage('');
      onClose();
      onDone(t('Gracias, lo hemos recibido'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo enviar. Inténtalo de nuevo.'));
    } finally { setBusy(false); }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet" role="dialog" aria-modal="true" aria-label={t('Reportar un fallo')}
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.22 }}
          >
            <div className="grabber" />
            <h2 className="sheet-title">{t('Reportar un fallo o una idea')}</h2>
            <div className="segmented" role="group" aria-label={t('Tipo de reporte')} style={{ margin: '14px 0' }}>
              {KINDS.map(([k, l]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(l)}</button>)}
            </div>
            <div className="field">
              <label htmlFor="rp-msg">{t('¿Qué ha pasado?')}</label>
              <textarea id="rp-msg" className="input" rows={5} maxLength={2000} autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('Qué estabas haciendo, qué esperabas y qué ocurrió.')} />
              <span className="hint">{t('Enviamos también la pantalla en la que estás y tu tipo de dispositivo. Nunca tus importes ni tus movimientos.')}</span>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" disabled={busy} onClick={send}>{t('Enviar reporte')}</button>
              <button className="btn btn-ghost" onClick={onClose}>{t('Cancelar')}</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

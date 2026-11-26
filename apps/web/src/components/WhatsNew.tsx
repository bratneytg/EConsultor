import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { KIND_LABEL, type Release } from '../content/novedades';
import { t } from '../lib/i18n';
import { Icon } from './Icon';

interface Props { open: boolean; releases: Release[]; version: string; onClose: () => void }

/** Ventana de novedades: qué ha cambiado desde la última vez que se abrió la app. */
export function WhatsNew({ open, releases, version, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && releases.length > 0 && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet whatsnew" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 34, stiffness: 380 }}
          >
            <div className="grabber" />
            <div className="imp-head">
              <h2 id="whatsnew-title">{t('Novedades')}</h2>
              <button className="icon-btn" aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={20} /></button>
            </div>
            <div className="whatsnew-body">
              {releases.map((r) => (
                <section key={r.version} aria-label={`${t('Versión')} ${r.version}`}>
                  <h3>{t(r.title)} <small>{t('Versión')} {r.version}</small></h3>
                  <ul>
                    {r.changes.map((c) => (
                      <li key={c.text}>
                        <em className={`wn-kind wn-${c.kind}`}>{t(KIND_LABEL[c.kind])}</em>
                        <span>{t(c.text)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p className="hint whatsnew-ver">{t('Tienes la versión {version}', { version })}</p>
            <button className="btn btn-primary btn-block" autoFocus onClick={onClose}>{t('Entendido')}</button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Aviso flotante: hay una versión nueva ya descargada; al recargar se usa. */
export function UpdateBanner({ onReload }: { onReload: () => void }) {
  return (
    <div className="update-banner" role="status">
      <span>{t('Hay una versión nueva de EConsultor.')}</span>
      <button className="btn btn-primary" onClick={onReload}>{t('Actualizar')}</button>
    </div>
  );
}

import type { Advice } from '@econsultor/shared';
import { money } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { t, tk } from '../lib/i18n';

const SEV: Record<Advice['severity'], { icon: IconName; label: string }> = {
  warn: { icon: 'warn', label: tk('Atención') },
  tip: { icon: 'spark', label: tk('Consejo') },
  win: { icon: 'trophy', label: tk('Buen trabajo') },
  info: { icon: 'info', label: tk('Para saber') },
};

/** Un consejo = una tarjeta: tipo, cifra clave (si la hay), título y explicación. */
export function AdviceCard({ a, currency, clamp = false }: { a: Advice; currency: string; clamp?: boolean }) {
  const s = SEV[a.severity];
  const perMonth = !(a.kind === 'saving' && a.id === 'emergency-fund');
  return (
    <article className="advice-card" data-sev={a.severity}>
      <div className="ac-top">
        <span className={`sev sev-${a.severity}`}><Icon name={s.icon} size={20} /></span>
        <span className="ac-tag">{t(s.label)}{a.scope === 'specific' ? t(' · para ti') : ''}</span>
      </div>
      {a.impactMinor ? (
        <div className="ac-figure">
          <span className="num">{money(a.impactMinor, currency, 0)}</span>
          <small>{perMonth ? t('al mes') : t('objetivo mínimo')}</small>
        </div>
      ) : null}
      <h3>{a.title}</h3>
      <p className={clamp ? 'clamp' : ''}>{a.body}</p>
      {a.action && <div className="ac-action"><b>{t('Qué hacer')}</b><span>{a.action}</span></div>}
    </article>
  );
}

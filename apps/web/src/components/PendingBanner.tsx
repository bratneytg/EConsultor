import { t } from '../lib/i18n';
import { useCapture } from '../lib/queries';
import { Icon } from './Icon';
import { useShell } from './Shell';

/** Aviso en Resumen y Movimientos: hay pagos que llegaron del móvil y esperan una categoría. */
export function PendingBanner() {
  const { openPending } = useShell();
  const { data } = useCapture();
  const n = data?.items.filter((i) => !i.test).length ?? 0;
  if (!data?.enabled || n === 0) return null;
  return (
    <button className="pending-banner" onClick={openPending}>
      <span className="dot" aria-hidden="true">{n}</span>
      <span style={{ flex: 1 }}>
        <b>{n === 1 ? t('1 pago del móvil espera tu confirmación') : t('{n} pagos del móvil esperan tu confirmación', { n })}</b>
        <span className="sub">{t('Elige su categoría y añádelos en un toque.')}</span>
      </span>
      <Icon name="right" size={18} />
    </button>
  );
}

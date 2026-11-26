import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { monthLabel } from '../lib/format';
import { t } from '../lib/i18n';
import { useCapture, useStatementReminder } from '../lib/queries';
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

/** Una vez al mes, si ya has subido extractos antes y este mes aún no: invita a subir el del mes pasado. */
export function StatementBanner() {
  const { openImport } = useShell();
  const qc = useQueryClient();
  const { data } = useStatementReminder();
  const { data: cap } = useCapture();
  if (!data?.due) return null;
  const dismiss = async () => qc.setQueryData(['statement-reminder'], await api('/import/reminder/dismiss', { method: 'POST' }));
  const captured = cap?.enabled === true;
  return (
    <div className="pending-banner" role="region" aria-label={t('Recordatorio del extracto')}>
      <span className="dot" aria-hidden="true"><Icon name="upload" size={14} /></span>
      <span style={{ flex: 1 }}>
        <b>{t('Es hora de subir el extracto de {month}', { month: monthLabel(data.statementMonth) })}</b>
        <span className="sub">{captured ? t('Completa lo que no captura el móvil. Lo ya capturado no se duplica.') : t('Así tus gráficas y consejos siguen al día.')}</span>
        <span style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary" onClick={openImport}>{t('Subir extracto')}</button>
          <button className="btn btn-ghost" onClick={dismiss}>{t('Ahora no')}</button>
        </span>
      </span>
    </div>
  );
}

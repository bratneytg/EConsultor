import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { useStatementReminder } from '../lib/queries';
import { Switch } from './ui';

/** Ajuste del recordatorio mensual: encender o apagar y a partir de qué día del mes se avisa. */
export function StatementReminderSetting() {
  const qc = useQueryClient();
  const { data } = useStatementReminder();
  if (!data) return null;
  const save = async (body: { enabled?: boolean; day?: number }) => qc.setQueryData(['statement-reminder'], await api('/import/reminder', { method: 'PUT', json: body }));
  return (
    <>
      <div className="setting">
        <div><b>{t('Recordarme subir el extracto cada mes')}</b><p>{t('Un aviso (banner y notificación) si este mes aún no has subido el extracto de tu banco.')}</p></div>
        <Switch label={t('Recordatorio mensual del extracto')} checked={data.enabled} onChange={(v) => save({ enabled: v })} />
      </div>
      {data.enabled && (
        <div className="setting">
          <div><b>{t('A partir del día')}</b><p>{t('Los bancos suelen tener el extracto listo en los primeros días del mes.')}</p></div>
          <select className="input" style={{ width: 90 }} aria-label={t('Día del mes del recordatorio')} value={data.day} onChange={(e) => save({ day: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

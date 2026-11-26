import { useState } from 'react';
import { apiBlob, ApiError } from '../lib/api';
import { useUser } from '../lib/auth';
import { isoToday, monthLabel, shiftMonth } from '../lib/format';
import { t } from '../lib/i18n';
import { saveBlobFile } from '../lib/native';
import { Card } from './ui';
import { Icon } from './Icon';
import { useShell } from './Shell';

/** Informe mensual en PDF: un resumen escrito del mes y los datos de gasto. */
export function ReportCard() {
  const user = useUser();
  const { toast } = useShell();
  const thisMonth = isoToday(user.timezone).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, -i));

  const download = async () => {
    setBusy(true);
    try {
      const blob = await apiBlob(`/report/monthly?month=${month}`);
      await saveBlobFile(`econsultor-${month}.pdf`, blob);
      toast(t('Informe listo'));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('No se pudo crear el informe. Inténtalo de nuevo.'));
    } finally { setBusy(false); }
  };

  return (
    <Card title={t('Informe mensual')} subtitle={t('Un PDF con el análisis escrito del mes y todos tus gastos: categorías, evolución y mayores gastos.')}>
      <div className="setting">
        <div style={{ flex: 1 }}>
          <label htmlFor="rep-month"><b>{t('Mes del informe')}</b></label>
          <select id="rep-month" className="input" style={{ marginTop: 6, maxWidth: 260 }} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={download}><Icon name="download" size={18} />{busy ? t('Creando…') : t('Descargar PDF')}</button>
      </div>
    </Card>
  );
}

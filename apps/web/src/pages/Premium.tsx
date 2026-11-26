import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { fmtDate, priceText, useCheckout } from '../components/Premium';
import { useShell } from '../components/Shell';
import { useUser } from '../lib/auth';
import { moneyParts } from '../lib/format';
import { t, tk } from '../lib/i18n';
import { useBilling } from '../lib/queries';

/** Lo que incluye cada plan. Solo lo que existe de verdad: si algo cambia en la app, se cambia aquí. */
const ROWS: { label: string; free: boolean }[] = [
  { label: tk('Anotar gastos e ingresos, sin límite'), free: true },
  { label: tk('Resumen, gráficas y «En qué se va»'), free: true },
  { label: tk('Gastos periódicos y categorías propias'), free: true },
  { label: tk('Importar extractos del banco'), free: true },
  { label: tk('Informe mensual en PDF'), free: true },
  { label: tk('Consejos y análisis a fondo calculados en el servidor, sin enviar datos fuera'), free: true },
  { label: tk('Consejos escritos por IA con tus comercios y tus hábitos'), free: false },
  { label: tk('Análisis a fondo mejorado con IA'), free: false },
  { label: tk('Actualizar los consejos cuando quieras'), free: false },
];

export function Premium() {
  const user = useUser();
  const nav = useNavigate();
  const { toast } = useShell();
  const { data: b } = useBilling();
  const { busy, start } = useCheckout();
  const [params, setParams] = useSearchParams();
  const premium = user.plan === 'premium';

  useEffect(() => {
    if (params.get('pago') === 'cancelado') { toast(t('No se ha hecho ningún cobro.')); setParams({}, { replace: true }); }
  }, [params, setParams, toast]);

  const price = b ? moneyParts(b.priceCents, b.currency.toUpperCase()) : null;
  const trial = b?.trialDays ?? 0;

  return (
    <div className="premium-page">
      <header className="page-head subpage-head">
        <button className="icon-btn" aria-label={t('Volver')} onClick={() => (window.history.length > 1 ? nav(-1) : nav('/consejos'))}><Icon name="left" size={20} /></button>
        <h1>{t('Premium')}</h1>
      </header>

      <section className="plan-hero card" aria-labelledby="plan-lead">
        <p id="plan-lead" className="plan-lead">{t('La IA lee tus movimientos y te escribe consejos con tus comercios y tus hábitos. Todo lo demás sigue siendo gratis.')}</p>

        {premium ? (
          <div className="plan-state">
            <span className="badge premium"><Icon name="check" size={14} /> {t('Ya tienes Premium')}</span>
            <p className="sub">
              {b?.source === 'subscription' && b.subscription?.renewsAt
                ? (b.subscription.cancelAtPeriodEnd ? t('Sigue activo hasta el {date}.', { date: fmtDate(b.subscription.renewsAt) }) : t('Próximo cobro el {date}.', { date: fmtDate(b.subscription.renewsAt) }))
                : b?.source === 'everyone' ? t('Premium está activado para todas las cuentas por ahora.')
                : b?.source === 'manual' ? t('Tu administrador te ha activado Premium.') : ''}
            </p>
            <Link className="btn" to="/ajustes/suscripcion">{t('Gestionar mi suscripción')}</Link>
          </div>
        ) : (
          <div className="plan-buy">
            {price && b ? (
              <p className="plan-price" aria-label={t('{price} al mes', { price: priceText(b) })}>
                <span className="plan-int">{price.int}</span><span className="plan-dec">{price.dec} {price.cur}</span><span className="plan-per">{t('al mes')}</span>
              </p>
            ) : <div className="plan-price skeleton" aria-hidden="true" />}
            <p className="sub">{trial > 0 ? t('{days} días gratis y después se cobra cada mes. Cancelas cuando quieras.', { days: trial }) : t('Sin permanencia: cancelas cuando quieras.')}</p>
            {b?.enabled ? (
              <button className="btn btn-primary btn-block" disabled={busy} onClick={start}>
                {busy ? t('Abriendo el pago…') : trial > 0 ? t('Probar {days} días gratis', { days: trial }) : t('Pasarme a Premium')}
              </button>
            ) : (
              <>
                <button className="btn btn-block" disabled>{t('Pasarme a Premium')}</button>
                <p className="hint">{t('Todavía no se puede pagar desde la app. En cuanto esté listo, aparecerá aquí.')}</p>
              </>
            )}
            <ul className="plan-facts">
              <li><Icon name="shield" size={16} />{t('El pago lo gestiona Stripe: EConsultor no guarda los datos de tu tarjeta.')}</li>
              <li><Icon name="lock" size={16} />{t('A la IA solo le llega un resumen (totales por categoría y comercios), nunca tu IBAN ni tus datos de acceso.')}</li>
            </ul>
          </div>
        )}
      </section>

      <section className="card compare-card" aria-labelledby="compare-h">
        <div className="card-head"><h2 id="compare-h">{t('Qué incluye cada plan')}</h2></div>
        <table className="compare">
          <thead>
            <tr><th scope="col"><span className="sr-only">{t('Función')}</span></th><th scope="col">{t('Gratis')}</th><th scope="col" className="col-premium">{t('Premium')}</th></tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label}>
                <th scope="row">{t(r.label)}</th>
                <td>{r.free ? <><Icon name="check" size={18} /><span className="sr-only">{t('Incluido')}</span></> : <><span aria-hidden="true" className="dash">–</span><span className="sr-only">{t('No incluido')}</span></>}</td>
                <td className="col-premium"><Icon name="check" size={18} /><span className="sr-only">{t('Incluido')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="ex-h">
        <div className="card-head"><div><h2 id="ex-h">{t('La diferencia, con un ejemplo')}</h2><p>{t('Ejemplo ilustrativo; tus consejos usarán tus datos reales.')}</p></div></div>
        <div className="example-pair">
          <div className="example">
            <span className="badge">{t('Gratis')}</span>
            <h3>{t('Restaurantes pesa un 31 % de tus gastos')}</h3>
            <p>{t('Es la categoría donde más gastas este mes.')}</p>
          </div>
          <div className="example ai">
            <span className="badge premium"><Icon name="spark" size={13} /> {t('Premium · IA')}</span>
            <h3>{t('Comes fuera casi todos los viernes')}</h3>
            <p>{t('Gastas unos 18 € cada vez en los mismos dos sitios. Llevarte la comida dos viernes al mes te ahorraría unos 36 €.')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

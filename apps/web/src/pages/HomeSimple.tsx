import { Link } from 'react-router-dom';
import { AdviceCard } from '../components/AdviceCard';
import { Icon, type IconName } from '../components/Icon';
import { ModeSwitch } from '../components/ModeSwitch';
import { useShell } from '../components/Shell';
import { Card, ChartCard, HeroMoney } from '../components/ui';
import { BalanceArea, BalanceLegend } from '../charts/BalanceArea';
import { Breakdown } from '../charts/Breakdown';
import { useUser } from '../lib/auth';
import { dayShort, money, monthLabel, pct, shiftMonth } from '../lib/format';
import { useAdvice, useOverview } from '../lib/queries';
import { t } from '../lib/i18n';

function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? t('Buenas noches') : h < 13 ? t('Buenos días') : h < 21 ? t('Buenas tardes') : t('Buenas noches');
}

/** Estado del mes en una frase: siempre icono + texto, nunca solo color. */
function status(income: number, net: number, rate: number): { tone: 'good' | 'warn' | 'serious' | 'none'; icon: IconName; text: string } {
  if (income === 0) return { tone: 'none', icon: 'info', text: t('Anota tus ingresos para ver cuánto ahorras') };
  if (net < 0) return { tone: 'serious', icon: 'warn', text: t('Este mes gastas más de lo que ingresas') };
  if (rate >= 0.2) return { tone: 'good', icon: 'trophy', text: t('Vas muy bien: ahorras el {pct}', { pct: pct(rate) }) };
  if (rate >= 0.1) return { tone: 'good', icon: 'check', text: t('Vas bien: ahorras el {pct}', { pct: pct(rate) }) };
  return { tone: 'warn', icon: 'info', text: t('Vas justo: ahorras el {pct}', { pct: pct(rate) }) };
}

/** Interfaz sencilla: el mes en un vistazo, dos gráficos y tres consejos. */
export function HomeSimple() {
  const user = useUser();
  const { month, setMonth, today, openAdd } = useShell();
  const { data: o, isPending, isError, isPlaceholderData, refetch } = useOverview(month);
  const { data: advice } = useAdvice();
  const isCurrent = month === today.slice(0, 7);
  const cur = user.currency;

  const head = (
    <header className="page-head">
      <div>
        <p className="muted" style={{ marginBottom: 4 }}>{greeting()}, {user.displayName.split(' ')[0]}</p>
        <h1>{t('Tu mes')}</h1>
      </div>
      <div className="head-tools">
        <ModeSwitch />
        <div className="month-switch" role="group" aria-label={t('Mes')}>
          <button aria-label={t('Mes anterior')} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" size={18} /></button>
          <span>{monthLabel(month)}</span>
          <button aria-label={t('Mes siguiente')} disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" size={18} /></button>
        </div>
      </div>
    </header>
  );

  if (isPending) return <>{head}<div className="loading-screen" style={{ minHeight: 320 }}><div className="pulse-dot" /></div></>;
  if (isError || !o) {
    return <>{head}<Card><div className="empty"><h3>{t('No hemos podido cargar tus datos')}</h3><p>{t('Comprueba la conexión con el servidor e inténtalo de nuevo.')}</p><button className="btn btn-primary" onClick={() => refetch()}>{t('Reintentar')}</button></div></Card></>;
  }

  const empty = o.totals.incomeMinor === 0 && o.totals.expenseMinor === 0;
  const st = status(o.totals.incomeMinor, o.totals.netMinor, o.totals.savingsRate);
  const fc = o.forecast;
  const showForecast = isCurrent && fc.daysElapsed < fc.daysInMonth && o.totals.expenseMinor > 0;

  return (
    <div className={isPlaceholderData ? 'refetching' : ''}>
      {head}

      {isCurrent && !o.loggedToday && (
        <div className="nudge">
          <span><b>{t('Hoy aún no has anotado nada.')}</b> <span className="sub">{t('Son 30 segundos.')}</span></span>
          <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />{t('Anotar ahora')}</button>
        </div>
      )}

      <section className="hero simple-hero" aria-label={t('Resumen del mes')}>
        <div>
          <p className="hero-label">{isCurrent ? t('Llevas este mes') : t('Balance de {month}', { month: monthLabel(month) })}</p>
          <HeroMoney minor={o.totals.netMinor} currency={cur} />
          <p className={`status ${st.tone}`} style={{ marginTop: 16 }}><Icon name={st.icon} size={17} />{st.text}</p>
          {showForecast && (
            <p className="sub" style={{ marginTop: 10 }}>
              {t('A este ritmo cerrarás el mes con')} <b className="num" style={{ color: fc.projectedNetMinor < 0 ? 'var(--serious)' : undefined }}>{money(fc.projectedNetMinor, cur, 0)}</b>.
            </p>
          )}
        </div>
      </section>

      <div className="kpis">
        <div className="kpi"><span className="key"><i style={{ background: 'var(--income)' }} />{t('Ingresos')}</span><b className="num">{money(o.totals.incomeMinor, cur, 0)}</b></div>
        <div className="kpi"><span className="key"><i style={{ background: 'var(--expense)' }} />{t('Gastos')}</span><b className="num">{money(o.totals.expenseMinor, cur, 0)}</b></div>
        <div className="kpi"><span className="key">{t('Ahorro')}</span><b className="num">{o.totals.incomeMinor > 0 ? pct(Math.max(0, o.totals.savingsRate)) : '—'}</b></div>
      </div>

      {empty ? (
        <Card>
          <div className="empty">
            <h3>{t('Empieza con tu primer movimiento')}</h3>
            <p>{t('Anota un gasto o un ingreso y verás cómo se dibuja tu mes.')}</p>
            <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />{t('Anotar movimiento')}</button>
          </div>
        </Card>
      ) : (
        <div className="grid">
          <ChartCard
            wide refetching={isPlaceholderData}
            title={t('Saldo del mes')} subtitle={t('Lo que ingresas menos lo que gastas, día a día.')}
            table={{ head: ['Día', 'Ingresos', 'Gastos', 'Saldo'], rows: o.daily.map((d) => [dayShort(d.date), money(d.incomeMinor, cur, 0), money(d.expenseMinor, cur, 0), money(d.balanceMinor, cur, 0)]) }}
          >
            <BalanceArea o={o} />
            <BalanceLegend />
          </ChartCard>

          <Card wide title={t('En qué gastas')} subtitle={t('Tus cuatro categorías más pesadas.')}>
            <Breakdown o={o} compact />
          </Card>
        </div>
      )}

      {advice && advice.items.length > 0 && (
        <section className="simple-advice" aria-label={t('Consejos para ti')}>
          <div className="section-head">
            <h2>{t('Para ti')}</h2>
            <Link to="/consejos" className="link">{t('Ver todos los consejos')}<Icon name="right" size={16} /></Link>
          </div>
          <div className="advice-grid">
            {advice.items.slice(0, 3).map((a) => <AdviceCard key={a.id} a={a} currency={cur} clamp />)}
          </div>
        </section>
      )}
    </div>
  );
}

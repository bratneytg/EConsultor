import { Icon } from '../components/Icon';
import { ModeSwitch } from '../components/ModeSwitch';
import { useShell } from '../components/Shell';
import { Card, ChartCard, HeroMoney, useNarrow } from '../components/ui';
import { BalanceArea, BalanceLegend } from '../charts/BalanceArea';
import { Breakdown } from '../charts/Breakdown';
import { FlowRiver } from '../charts/FlowRiver';
import { HealthParts, HealthRing } from '../charts/HealthRing';
import { MonthlyColumns } from '../charts/MonthlyColumns';
import { WeekdayBars } from '../charts/WeekdayBars';
import { useUser } from '../lib/auth';
import { CatTile } from '../components/ui';
import { categoryLabel } from '../lib/categories';
import { dayShort, money, monthLabel, monthShort, pct, shiftMonth, weekdayName } from '../lib/format';
import { useOverview } from '../lib/queries';
import { t } from '../lib/i18n';

function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? t('Buenas noches') : h < 13 ? t('Buenos días') : h < 21 ? t('Buenas tardes') : t('Buenas noches');
}

export function HomePro() {
  const user = useUser();
  const { month, setMonth, today, openAdd } = useShell();
  const { data: o, isPending, isError, isPlaceholderData, refetch } = useOverview(month);
  const isCurrent = month === today.slice(0, 7);
  const cur = user.currency;
  const narrow = useNarrow();

  const head = (
    <header className="page-head">
      <div>
        <p className="muted" style={{ marginBottom: 4 }}>{greeting()}, {user.displayName.split(' ')[0]}</p>
        <h1>{t('Tu economía')}</h1>
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

  const empty = o.totals.incomeMinor === 0 && o.totals.expenseMinor === 0 && o.monthly.every((m) => m.incomeMinor + m.expenseMinor === 0);
  const sr = o.totals.savingsRate;
  const fcNet = o.forecast.projectedNetMinor;

  return (
    <div className={isPlaceholderData ? 'refetching' : ''}>
      {head}

      {isCurrent && !o.loggedToday && (
        <div className="nudge">
          <span><b>{t('Hoy aún no has anotado nada.')}</b> <span className="sub">{t('Son 30 segundos y tus gráficas se mantienen al día.')}</span></span>
          <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />{t('Anotar ahora')}</button>
        </div>
      )}

      <section className="hero" aria-label={t('Resumen del mes')}>
        <div>
          <p className="hero-label">{isCurrent ? t('Llevas este mes') : t('Balance de {month}', { month: monthLabel(month) })}</p>
          <HeroMoney minor={o.totals.netMinor} currency={cur} />
          <div className="hero-meta">
            <div><span className="key"><i style={{ background: 'var(--income)' }} />{t('Ingresos')}</span><b className="num">{money(o.totals.incomeMinor, cur, 0)}</b></div>
            <div><span className="key"><i style={{ background: 'var(--expense)' }} />{t('Gastos')}</span><b className="num">{money(o.totals.expenseMinor, cur, 0)}</b></div>
            <div><span className="key">{t('Ahorro')}</span><b className="num">{o.totals.incomeMinor > 0 ? pct(Math.max(0, sr)) : '—'}</b></div>
            {isCurrent && o.forecast.daysElapsed < o.forecast.daysInMonth && o.totals.expenseMinor > 0 && (
              <div><span className="key">{t('Cierre previsto')}</span><b className="num" style={{ color: fcNet < 0 ? 'var(--serious)' : undefined }}>{money(fcNet, cur, 0)}</b></div>
            )}
          </div>
          {isCurrent && o.streakDays > 1 && <p className="streak" style={{ marginTop: 18 }}><Icon name="flame" size={17} />{t('{n} días seguidos anotando', { n: o.streakDays })}</p>}
        </div>
        <HealthRing health={o.health} size={narrow ? 120 : 168} />
      </section>

      {empty ? (
        <Card>
          <div className="empty">
            <h3>{t('Empieza con tu primer movimiento')}</h3>
            <p>{t('Anota un gasto o un ingreso y verás cómo se dibuja tu mes: saldo, categorías, previsión y más.')}</p>
            <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />{t('Anotar movimiento')}</button>
          </div>
        </Card>
      ) : (
        <div className="grid">
          <ChartCard
            wide refetching={isPlaceholderData}
            title={t('Saldo del mes')} subtitle={t('Cómo evoluciona lo que ingresas menos lo que gastas, día a día.')}
            table={{ head: ['Día', 'Ingresos', 'Gastos', 'Saldo'], rows: o.daily.map((d) => [dayShort(d.date), money(d.incomeMinor, cur, 0), money(d.expenseMinor, cur, 0), money(d.balanceMinor, cur, 0)]) }}
          >
            <BalanceArea o={o} />
            <BalanceLegend />
          </ChartCard>

          <ChartCard
            wide title={t('El río de tu dinero')} subtitle={t('De dónde entra y a dónde se va cada euro.')}
            table={{ head: [t('Concepto'), t('Importe')], rows: [...o.incomeByCategory.map((c) => [`+ ${categoryLabel(c.categoryId)}`, money(c.amountMinor, cur, 0)]), ...o.expenseByCategory.map((c) => [`− ${categoryLabel(c.categoryId)}`, money(c.amountMinor, cur, 0)])] }}
          >
            <FlowRiver o={o} />
          </ChartCard>

          <Card title={t('En qué se va')} subtitle={t('Reparto del gasto y cambio frente al mes anterior.')} className="wide">
            <Breakdown o={o} />
          </Card>

          <Card title={t('Tu pulso financiero')} subtitle={t('Cuatro hábitos que, juntos, definen tu salud económica.')}>
            <HealthParts health={o.health} />
          </Card>

          <Card title={t('Mayores gastos')} subtitle={t('Los cinco más grandes de {month}.', { month: monthLabel(month) })}>
            {o.topExpenses.length === 0 ? <p className="muted">{t('Sin gastos todavía.')}</p> : (
              <div className="rank">
                {o.topExpenses.map((t) => (
                  <button key={t.id} className="tx-row" onClick={() => openAdd(t)}>
                    <CatTile id={t.categoryId} />
                    <div><div className="t">{t.note || categoryLabel(t.categoryId)}</div><div className="c">{dayShort(t.date)} · {categoryLabel(t.categoryId)}</div></div>
                    <div className="a num">{money(t.amountMinor, cur, 0)}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <ChartCard
            wide title={t('Últimos 12 meses')} subtitle={t('Toca un mes para abrirlo.')}
            table={{ head: ['Mes', 'Ingresos', 'Gastos', 'Balance'], rows: o.monthly.map((m) => [monthShort(m.month), money(m.incomeMinor, cur, 0), money(m.expenseMinor, cur, 0), money(m.incomeMinor - m.expenseMinor, cur, 0)]) }}
          >
            <MonthlyColumns o={o} onSelect={setMonth} />
          </ChartCard>

          <ChartCard
            title={t('Tu semana')} subtitle={t('Gasto medio por día, últimos 3 meses.')}
            table={{ head: [t('Día'), t('Gasto medio')], rows: o.weekday.map((d) => [weekdayName(d.weekday), money(d.avgExpenseMinor, cur, 0)]) }}
          >
            <WeekdayBars o={o} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

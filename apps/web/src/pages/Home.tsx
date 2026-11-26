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

function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
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
        <h1>Tu economía</h1>
      </div>
      <div className="head-tools">
        <ModeSwitch />
        <div className="month-switch" role="group" aria-label="Mes">
          <button aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" size={18} /></button>
          <span>{monthLabel(month)}</span>
          <button aria-label="Mes siguiente" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" size={18} /></button>
        </div>
      </div>
    </header>
  );

  if (isPending) return <>{head}<div className="loading-screen" style={{ minHeight: 320 }}><div className="pulse-dot" /></div></>;
  if (isError || !o) {
    return <>{head}<Card><div className="empty"><h3>No hemos podido cargar tus datos</h3><p>Comprueba la conexión con el servidor e inténtalo de nuevo.</p><button className="btn btn-primary" onClick={() => refetch()}>Reintentar</button></div></Card></>;
  }

  const empty = o.totals.incomeMinor === 0 && o.totals.expenseMinor === 0 && o.monthly.every((m) => m.incomeMinor + m.expenseMinor === 0);
  const sr = o.totals.savingsRate;
  const fcNet = o.forecast.projectedNetMinor;

  return (
    <div className={isPlaceholderData ? 'refetching' : ''}>
      {head}

      {isCurrent && !o.loggedToday && (
        <div className="nudge">
          <span><b>Hoy aún no has anotado nada.</b> <span className="sub">Son 30 segundos y tus gráficas se mantienen al día.</span></span>
          <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />Anotar ahora</button>
        </div>
      )}

      <section className="hero" aria-label="Resumen del mes">
        <div>
          <p className="hero-label">{isCurrent ? 'Llevas este mes' : `Balance de ${monthLabel(month)}`}</p>
          <HeroMoney minor={o.totals.netMinor} currency={cur} />
          <div className="hero-meta">
            <div><span className="key"><i style={{ background: 'var(--income)' }} />Ingresos</span><b className="num">{money(o.totals.incomeMinor, cur, 0)}</b></div>
            <div><span className="key"><i style={{ background: 'var(--expense)' }} />Gastos</span><b className="num">{money(o.totals.expenseMinor, cur, 0)}</b></div>
            <div><span className="key">Ahorro</span><b className="num">{o.totals.incomeMinor > 0 ? pct(Math.max(0, sr)) : '—'}</b></div>
            {isCurrent && o.forecast.daysElapsed < o.forecast.daysInMonth && o.totals.expenseMinor > 0 && (
              <div><span className="key">Cierre previsto</span><b className="num" style={{ color: fcNet < 0 ? 'var(--serious)' : undefined }}>{money(fcNet, cur, 0)}</b></div>
            )}
          </div>
          {isCurrent && o.streakDays > 1 && <p className="streak" style={{ marginTop: 18 }}><Icon name="flame" size={17} />{o.streakDays} días seguidos anotando</p>}
        </div>
        <HealthRing health={o.health} size={narrow ? 120 : 168} />
      </section>

      {empty ? (
        <Card>
          <div className="empty">
            <h3>Empieza con tu primer movimiento</h3>
            <p>Anota un gasto o un ingreso y verás cómo se dibuja tu mes: saldo, categorías, previsión y más.</p>
            <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />Anotar movimiento</button>
          </div>
        </Card>
      ) : (
        <div className="grid">
          <ChartCard
            wide refetching={isPlaceholderData}
            title="Saldo del mes" subtitle="Cómo evoluciona lo que ingresas menos lo que gastas, día a día."
            table={{ head: ['Día', 'Ingresos', 'Gastos', 'Saldo'], rows: o.daily.map((d) => [dayShort(d.date), money(d.incomeMinor, cur, 0), money(d.expenseMinor, cur, 0), money(d.balanceMinor, cur, 0)]) }}
          >
            <BalanceArea o={o} />
            <BalanceLegend />
          </ChartCard>

          <ChartCard
            wide title="El río de tu dinero" subtitle="De dónde entra y a dónde se va cada euro."
            table={{ head: ['Concepto', 'Importe'], rows: [...o.incomeByCategory.map((c) => [`+ ${categoryLabel(c.categoryId)}`, money(c.amountMinor, cur, 0)]), ...o.expenseByCategory.map((c) => [`− ${categoryLabel(c.categoryId)}`, money(c.amountMinor, cur, 0)])] }}
          >
            <FlowRiver o={o} />
          </ChartCard>

          <Card title="En qué se va" subtitle="Reparto del gasto y cambio frente al mes anterior." className="wide">
            <Breakdown o={o} />
          </Card>

          <Card title="Tu pulso financiero" subtitle="Cuatro hábitos que, juntos, definen tu salud económica.">
            <HealthParts health={o.health} />
          </Card>

          <Card title="Mayores gastos" subtitle={`Los cinco más grandes de ${monthLabel(month)}.`}>
            {o.topExpenses.length === 0 ? <p className="muted">Sin gastos todavía.</p> : (
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
            wide title="Últimos 12 meses" subtitle="Toca un mes para abrirlo."
            table={{ head: ['Mes', 'Ingresos', 'Gastos', 'Balance'], rows: o.monthly.map((m) => [monthShort(m.month), money(m.incomeMinor, cur, 0), money(m.expenseMinor, cur, 0), money(m.incomeMinor - m.expenseMinor, cur, 0)]) }}
          >
            <MonthlyColumns o={o} onSelect={setMonth} />
          </ChartCard>

          <ChartCard
            title="Tu semana" subtitle="Gasto medio por día, últimos 3 meses."
            table={{ head: ['Día', 'Gasto medio'], rows: o.weekday.map((d) => [weekdayName(d.weekday), money(d.avgExpenseMinor, cur, 0)]) }}
          >
            <WeekdayBars o={o} />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { CatTile } from '../components/ui';
import { useUser } from '../lib/auth';
import { api } from '../lib/api';
import { categoryLabel } from '../lib/categories';
import { money, monthLabel, relativeDay, shiftMonth } from '../lib/format';
import { useAppConfig, useInvalidateData, useMonthTransactions } from '../lib/queries';

type Filter = 'all' | 'expense' | 'income';

export function Transactions() {
  const user = useUser();
  const { month, setMonth, today, openAdd, toast } = useShell();
  const { data, isPending, isPlaceholderData } = useMonthTransactions(month);
  const { data: cfg } = useAppConfig();
  const invalidate = useInvalidateData();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const isCurrent = month === today.slice(0, 7);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = (data ?? []).filter((t) => (filter === 'all' || t.type === filter) && (!needle || (t.note ?? '').toLowerCase().includes(needle) || categoryLabel(t.categoryId).toLowerCase().includes(needle)));
    const map = new Map<string, typeof items>();
    for (const t of items) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data, filter, q]);

  const loadDemo = async () => {
    try {
      await api('/dev/demo-data', { method: 'POST' });
      await invalidate();
      toast('Datos de demostración cargados');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className={isPlaceholderData ? 'refetching' : ''}>
      <header className="page-head">
        <h1>Movimientos</h1>
        <div className="month-switch" role="group" aria-label="Mes">
          <button aria-label="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" size={18} /></button>
          <span>{monthLabel(month)}</span>
          <button aria-label="Mes siguiente" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" size={18} /></button>
        </div>
      </header>

      <div style={{ display: 'grid', gap: 12, marginBottom: 6 }}>
        <input className="input" type="search" placeholder="Buscar por nota o categoría" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pills" role="group" aria-label="Filtrar por tipo">
          {([['all', 'Todos'], ['expense', 'Gastos'], ['income', 'Ingresos']] as const).map(([k, l]) => (
            <button key={k} className="pill" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      {isPending ? (
        <div className="loading-screen" style={{ minHeight: 240 }}><div className="pulse-dot" /></div>
      ) : groups.length === 0 ? (
        <div className="card empty" style={{ marginTop: 14 }}>
          <h3>{q || filter !== 'all' ? 'Nada coincide con ese filtro' : 'Sin movimientos este mes'}</h3>
          <p>{q || filter !== 'all' ? 'Prueba con otra búsqueda o quita el filtro.' : 'Anota tu primer gasto o ingreso para empezar a ver tus gráficas.'}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />Anotar movimiento</button>
            {cfg?.demo && !q && filter === 'all' && <button className="btn" onClick={loadDemo}>Cargar datos de demostración</button>}
          </div>
        </div>
      ) : (
        groups.map(([date, items]) => {
          const net = items.reduce((s, t) => s + (t.type === 'income' ? t.amountMinor : -t.amountMinor), 0);
          return (
            <section key={date} aria-label={relativeDay(date, today)}>
              <div className="day-head"><span>{relativeDay(date, today)}</span><span className="num">{net >= 0 ? '+' : '−'}{money(Math.abs(net), user.currency, 0)}</span></div>
              <div className="list">
                {items.map((t) => (
                  <button key={t.id} className="tx-row" onClick={() => openAdd(t)}>
                    <CatTile id={t.categoryId} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{t.note || categoryLabel(t.categoryId)}</div>
                      <div className="c">{t.note ? categoryLabel(t.categoryId) : t.type === 'income' ? 'Ingreso' : 'Gasto'}</div>
                    </div>
                    <div className={`a num ${t.type === 'income' ? 'in' : ''}`}>{t.type === 'income' ? '+' : '−'}{money(t.amountMinor, t.currency)}</div>
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

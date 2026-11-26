import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { CatTile } from '../components/ui';
import { useUser } from '../lib/auth';
import { api } from '../lib/api';
import { CATEGORY_IDS } from '@econsultor/shared';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryLabel } from '../lib/categories';
import { money, monthLabel, relativeDay, shiftMonth } from '../lib/format';
import { t } from '../lib/i18n';
import { useAppConfig, useInvalidateData, useMonthTransactions } from '../lib/queries';

type Filter = 'all' | 'expense' | 'income';

export function Transactions() {
  const user = useUser();
  const { month, setMonth, today, openAdd, openImport, toast } = useShell();
  const { data, isPending, isPlaceholderData } = useMonthTransactions(month);
  const { data: cfg } = useAppConfig();
  const invalidate = useInvalidateData();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [acc, setAcc] = useState<string | null>(null);
  // Categorías filtradas: viven en la dirección (?cat=housing,utilities) para poder enlazarlas desde «En qué se va».
  const [params, setParams] = useSearchParams();
  const cats = useMemo(() => (params.get('cat') ?? '').split(',').filter((c) => (CATEGORY_IDS as readonly string[]).includes(c)), [params]);
  const setCats = (next: string[]) => {
    const p = new URLSearchParams(params);
    if (next.length) p.set('cat', next.join(',')); else p.delete('cat');
    setParams(p, { replace: true });
  };
  const isCurrent = month === today.slice(0, 7);

  /** Cuentas que aparecen este mes ('' = la principal). Solo se muestra el filtro si hay más de una. */
  const accounts = useMemo(() => [...new Set((data ?? []).map((x) => x.account ?? ''))].sort((a, b) => a.localeCompare(b)), [data]);
  const filterAcc = acc !== null && accounts.includes(acc) ? acc : null;
  const accLabel = (n: string) => n || t('Cuenta principal');

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = (data ?? []).filter((x) =>
      (filter === 'all' || x.type === filter)
      && (filterAcc === null || (x.account ?? '') === filterAcc)
      && (cats.length === 0 || cats.includes(x.categoryId))
      && (!needle || (x.note ?? '').toLowerCase().includes(needle) || categoryLabel(x.categoryId).toLowerCase().includes(needle)));
    const map = new Map<string, typeof items>();
    for (const x of items) map.set(x.date, [...(map.get(x.date) ?? []), x]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data, filter, q, filterAcc, cats]);

  const loadDemo = async () => {
    try {
      await api('/dev/demo-data', { method: 'POST' });
      await invalidate();
      toast(t('Datos de demostración cargados'));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className={isPlaceholderData ? 'refetching' : ''}>
      <header className="page-head">
        <h1>{t('Movimientos')}</h1>
        <div className="month-switch" role="group" aria-label={t('Mes')}>
          <button aria-label={t('Mes anterior')} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" size={18} /></button>
          <span>{monthLabel(month)}</span>
          <button aria-label={t('Mes siguiente')} disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" size={18} /></button>
        </div>
        <button className="btn" onClick={openImport}><Icon name="upload" size={18} />{t('Importar extractos bancarios')}</button>
      </header>

      <div style={{ display: 'grid', gap: 12, marginBottom: 6 }}>
        <input className="input" type="search" placeholder={t('Buscar por nota o categoría')} aria-label={t('Buscar')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pills" role="group" aria-label={t('Filtrar por tipo')}>
          {([['all', t('Todos')], ['expense', t('Gastos')], ['income', t('Ingresos')]] as const).map(([k, l]) => (
            <button key={k} className="pill" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="cat-filter">
          <select
            className="input" aria-label={t('Filtrar por categoría')} value=""
            onChange={(e) => { const v = e.target.value; if (v && !cats.includes(v)) setCats([...cats, v]); }}
          >
            <option value="">{cats.length ? t('Añadir otra categoría…') : t('Todas las categorías')}</option>
            {filter !== 'income' && (
              <optgroup label={t('Gastos')}>
                {EXPENSE_CATEGORIES.filter((c) => !cats.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}
              </optgroup>
            )}
            {filter !== 'expense' && (
              <optgroup label={t('Ingresos')}>
                {INCOME_CATEGORIES.filter((c) => !cats.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}
              </optgroup>
            )}
          </select>
          {cats.length > 0 && (
            <div className="pills">
              {cats.map((c) => (
                <button key={c} className="pill" aria-pressed="true" aria-label={t('Quitar el filtro {name}', { name: categoryLabel(c) })} onClick={() => setCats(cats.filter((x) => x !== c))}>
                  {categoryLabel(c)} ✕
                </button>
              ))}
              {cats.length > 1 && <button className="pill" onClick={() => setCats([])}>{t('Quitar filtros')}</button>}
            </div>
          )}
        </div>
        {accounts.length > 1 && (
          <div className="pills" role="group" aria-label={t('Filtrar por cuenta')}>
            <button className="pill" aria-pressed={filterAcc === null} onClick={() => setAcc(null)}>{t('Todas las cuentas')}</button>
            {accounts.map((n) => <button key={n || 'main'} className="pill" aria-pressed={filterAcc === n} onClick={() => setAcc(n)}>{accLabel(n)}</button>)}
          </div>
        )}
      </div>

      {isPending ? (
        <div className="loading-screen" style={{ minHeight: 240 }}><div className="pulse-dot" /></div>
      ) : groups.length === 0 ? (
        <div className="card empty" style={{ marginTop: 14 }}>
          <h3>{q || filter !== 'all' || filterAcc !== null || cats.length > 0 ? t('Nada coincide con ese filtro') : t('Sin movimientos este mes')}</h3>
          <p>{q || filter !== 'all' || filterAcc !== null || cats.length > 0 ? t('Prueba con otra búsqueda o quita el filtro.') : t('Anota tu primer gasto o ingreso para empezar a ver tus gráficas.')}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => openAdd()}><Icon name="plus" size={18} />{t('Anotar movimiento')}</button>
            {cfg?.demo && !q && filter === 'all' && <button className="btn" onClick={loadDemo}>{t('Cargar datos de demostración')}</button>}
          </div>
        </div>
      ) : (
        groups.map(([date, items]) => {
          const net = items.reduce((s, x) => s + (x.type === 'income' ? x.amountMinor : -x.amountMinor), 0);
          return (
            <section key={date} aria-label={relativeDay(date, today)}>
              <div className="day-head"><span>{relativeDay(date, today)}</span><span className="num">{net >= 0 ? '+' : '−'}{money(Math.abs(net), user.currency, 0)}</span></div>
              <div className="list">
                {items.map((x) => (
                  <button key={x.id} className="tx-row" onClick={() => openAdd(x)}>
                    <CatTile id={x.categoryId} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{x.note || categoryLabel(x.categoryId)}</div>
                      <div className="c">
                        {x.note ? categoryLabel(x.categoryId) : x.type === 'income' ? t('Ingreso') : t('Gasto')}
                        {accounts.length > 1 && ` · ${accLabel(x.account ?? '')}`}
                      </div>
                    </div>
                    <div className={`a num ${x.type === 'income' ? 'in' : ''}`}>{x.type === 'income' ? '+' : '−'}{money(x.amountMinor, x.currency)}</div>
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

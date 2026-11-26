import type { Overview } from '@econsultor/shared';
import { arc as d3arc, pie as d3pie } from 'd3-shape';
import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CatTile, Tip, pointerIn, type TipState } from '../components/ui';
import { FAMILIES, categoryLabel, familyOf } from '../lib/categories';
import { money, monthShort, pct, shiftMonth } from '../lib/format';
import { t } from '../lib/i18n';

type View = 'bars' | 'pie';
const VIEW_KEY = 'ec_breakdown_view';
/** La vista elegida se recuerda en este dispositivo (si el almacenamiento falla, se usa la de barras). */
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'pie' ? 'pie' : 'bars'; } catch { return 'bars'; } };
const saveView = (v: View): void => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* sin almacenamiento */ } };

/** Barra segmentada o gráfico de tarta (un total repartido en familias) + ranking de categorías con variación mensual. */
export function Breakdown({ o, compact = false }: { o: Overview; compact?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); saveView(v); setTip(null); };
  const nav = useNavigate();
  const total = o.totals.expenseMinor;
  if (!total) return <p className="muted">{t('Aún no hay gastos este mes.')}</p>;

  const fam = FAMILIES.map((f) => {
    const cats = o.expenseByCategory.filter((c) => familyOf(c.categoryId).id === f.id);
    return { f, amount: cats.reduce((s, c) => s + c.amountMinor, 0), cats };
  })
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const showTip = (e: { clientX: number; clientY: number }, x: (typeof fam)[number]) => {
    const p = pointerIn(e, wrap.current!);
    setTip({
      ...p,
      title: `${x.f.label} · ${pct(x.amount / total)}`,
      rows: [
        ...x.cats.slice(0, 5).map((c) => ({ color: x.f.color, label: categoryLabel(c.categoryId), value: money(c.amountMinor, o.currency, 0) })),
      ],
    });
  };

  const maxCat = o.expenseByCategory[0]?.amountMinor ?? 1;
  const prevLabel = monthShort(shiftMonth(o.month, -1));

  const goto = (x: (typeof fam)[number]) => `/movimientos?cat=${x.cats.map((c) => c.categoryId).join(',')}`;
  const slices = d3pie<(typeof fam)[number]>().sort(null).value((x) => x.amount)(fam);
  const arcGen = d3arc<{ startAngle: number; endAngle: number }>().innerRadius(0).outerRadius(104);
  const labelArc = d3arc<{ startAngle: number; endAngle: number }>().innerRadius(60).outerRadius(60);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <div className="segmented view-toggle" role="group" aria-label={t('Cómo ver el reparto del gasto')}>
        <button aria-pressed={view === 'bars'} onClick={() => setView('bars')}>{t('Barras')}</button>
        <button aria-pressed={view === 'pie'} onClick={() => setView('pie')}>{t('Tarta')}</button>
      </div>

      {view === 'pie' && (
        <div className="pie-wrap">
          <svg className="pie" viewBox="-110 -110 220 220" role="img" aria-label={t('Reparto del gasto por familia')}>
            {slices.map((sl) => {
              const x = sl.data;
              const share = x.amount / total;
              const [lx, ly] = labelArc.centroid(sl);
              return (
                <g key={x.f.id}>
                  <path
                    d={arcGen(sl) ?? ''} fill={x.f.color} stroke="var(--surface)" strokeWidth={2} className="pie-slice" tabIndex={0} role="link"
                    aria-label={`${x.f.label}: ${money(x.amount, o.currency, 0)}, ${pct(share)}`}
                    onPointerMove={(e) => showTip(e, x)} onPointerLeave={() => setTip(null)}
                    onClick={() => nav(goto(x))} onKeyDown={(e) => e.key === 'Enter' && nav(goto(x))}
                    onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.top }, x); }}
                    onBlur={() => setTip(null)}
                  />
                  {share >= 0.07 && <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className={`pie-label ${x.f.darkText ? 'dark' : ''}`} pointerEvents="none">{pct(share)}</text>}
                </g>
              );
            })}
          </svg>
          <ul className="pie-legend">
            {fam.map((x) => (
              <li key={x.f.id}>
                <Link className="seg-link" to={goto(x)}>
                  <i className="sw" style={{ background: x.f.color }} />
                  <span className="pl-name">{x.f.label}</span>
                  <span className="pl-amt num">{money(x.amount, o.currency, 0)}</span>
                  <span className="pl-pct num">{pct(x.amount / total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'bars' && <>
      <div className="seg-bar" role="list" aria-label={t('Reparto del gasto por familia')}>
        {fam.map((x) => (
          <button
            key={x.f.id}
            role="listitem"
            className={`seg ${x.f.darkText ? 'dark-text' : ''}`}
            style={{ flex: `${x.amount} 1 0`, background: x.f.color }}
            aria-label={`${x.f.label}: ${money(x.amount, o.currency, 0)}, ${pct(x.amount / total)}`}
            onPointerMove={(e) => showTip(e, x)}
            onPointerLeave={() => setTip(null)}
            onClick={() => nav(goto(x))}
            onFocus={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              showTip({ clientX: r.left + r.width / 2, clientY: r.top }, x);
            }}
            onBlur={() => setTip(null)}
          >
            {x.amount / total >= 0.13 ? pct(x.amount / total) : ''}
          </button>
        ))}
      </div>
      <div className="legend" style={{ marginBottom: 12 }}>
        {fam.map((x) => <Link key={x.f.id} className="seg-link" to={goto(x)}><i className="sw" style={{ background: x.f.color }} />{x.f.label}</Link>)}
      </div>
      </>}
      <Tip tip={tip} />

      <div className="rank">
        {o.expenseByCategory.slice(0, compact ? 4 : 8).map((c) => {
          const ch = c.prevAmountMinor > 0 ? (c.amountMinor - c.prevAmountMinor) / c.prevAmountMinor : null;
          const color = familyOf(c.categoryId).color;
          return (
            <Link className="rank-link" key={c.categoryId} to={`/movimientos?cat=${c.categoryId}`} aria-label={t('Ver los movimientos de {name}', { name: categoryLabel(c.categoryId) })}>
            <div className="rank-row">
              <CatTile id={c.categoryId} />
              <div>
                <div className="name"><span>{categoryLabel(c.categoryId)}</span></div>
                <div className="meter" aria-hidden="true"><i style={{ width: `${(c.amountMinor / maxCat) * 100}%`, background: color }} /></div>
              </div>
              <div className="amt num">
                {money(c.amountMinor, o.currency, 0)}
                {!compact && ch !== null && Math.abs(ch) >= 0.03 ? (
                  <span className={`delta ${ch > 0 ? 'up' : 'down'}`}>{ch > 0 ? '▲' : '▼'} {t('{pct} vs {month}', { pct: pct(Math.abs(ch)), month: prevLabel })}</span>
                ) : (
                  <span className="delta">{t('{pct} del gasto', { pct: pct(c.share) })}</span>
                )}
              </div>
            </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

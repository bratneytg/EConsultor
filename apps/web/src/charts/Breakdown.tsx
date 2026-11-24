import type { Overview } from '@econsultor/shared';
import { useRef, useState } from 'react';
import { CatTile, Tip, pointerIn, type TipState } from '../components/ui';
import { FAMILIES, categoryLabel, familyOf } from '../lib/categories';
import { money, monthShort, pct, shiftMonth } from '../lib/format';

/** Barra segmentada (un total repartido en familias) + ranking de categorías con variación mensual. */
export function Breakdown({ o }: { o: Overview }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const total = o.totals.expenseMinor;
  if (!total) return <p className="muted">Aún no hay gastos este mes.</p>;

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

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <div className="seg-bar" role="list" aria-label="Reparto del gasto por familia">
        {fam.map((x) => (
          <button
            key={x.f.id}
            role="listitem"
            className={`seg ${x.f.darkText ? 'dark-text' : ''}`}
            style={{ flex: `${x.amount} 1 0`, background: x.f.color }}
            aria-label={`${x.f.label}: ${money(x.amount, o.currency, 0)}, ${pct(x.amount / total)}`}
            onPointerMove={(e) => showTip(e, x)}
            onPointerLeave={() => setTip(null)}
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
        {fam.map((x) => <span key={x.f.id}><i className="sw" style={{ background: x.f.color }} />{x.f.label}</span>)}
      </div>
      <Tip tip={tip} />

      <div className="rank">
        {o.expenseByCategory.slice(0, 8).map((c) => {
          const ch = c.prevAmountMinor > 0 ? (c.amountMinor - c.prevAmountMinor) / c.prevAmountMinor : null;
          const color = familyOf(c.categoryId).color;
          return (
            <div className="rank-row" key={c.categoryId}>
              <CatTile id={c.categoryId} />
              <div>
                <div className="name"><span>{categoryLabel(c.categoryId)}</span></div>
                <div className="meter" aria-hidden="true"><i style={{ width: `${(c.amountMinor / maxCat) * 100}%`, background: color }} /></div>
              </div>
              <div className="amt num">
                {money(c.amountMinor, o.currency, 0)}
                {ch !== null && Math.abs(ch) >= 0.03 ? (
                  <span className={`delta ${ch > 0 ? 'up' : 'down'}`}>{ch > 0 ? '▲' : '▼'} {pct(Math.abs(ch))} vs {prevLabel}</span>
                ) : (
                  <span className="delta">{pct(c.share)} del gasto</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

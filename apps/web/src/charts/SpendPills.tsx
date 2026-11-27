import type { Overview } from '@econsultor/shared';
import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useCountUp } from '../components/ui';
import { FAMILIES, categoryLabel, familyOf } from '../lib/categories';
import { categoryEmoji } from '../lib/emoji';
import { money, monthShort, pct, shiftMonth } from '../lib/format';
import { t } from '../lib/i18n';

function Amount({ minor, currency }: { minor: number; currency: string }) {
  const v = useCountUp(minor, 900);
  return <b className="num">{money(Math.round(v), currency, 0)}</b>;
}

/** Frase que resume dónde se va el dinero, en tono cercano. */
function headline(share: number, cat: string): string {
  if (share >= 0.5) return t('Más de la mitad se va en {cat}', { cat });
  if (share >= 0.4) return t('Casi la mitad se va en {cat}', { cat });
  if (share >= 0.25) return t('Un buen trozo se va en {cat}', { cat });
  return t('Lo que más pesa: {cat}', { cat });
}

/** «En qué se va tu dinero»: frase directa, barra apilada y píldoras con emoji que crecen con rebote. */
export function SpendPills({ o, limit = 5 }: { o: Overview; limit?: number }) {
  const total = o.totals.expenseMinor;
  const fam = useMemo(() => FAMILIES.map((f) => {
    const cats = o.expenseByCategory.filter((c) => familyOf(c.categoryId).id === f.id);
    return { f, amount: cats.reduce((s, c) => s + c.amountMinor, 0), cats };
  }).filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount), [o]);

  if (!total || !o.expenseByCategory.length) return <p className="muted">{t('Aún no hay gastos este mes.')}</p>;

  const top = o.expenseByCategory[0]!;
  const maxCat = top.amountMinor;
  const prevLabel = monthShort(shiftMonth(o.month, -1));

  return (
    <div className="fun-spend">
      <p className="fun-headline">
        <span className="em" aria-hidden="true">{categoryEmoji(top.categoryId)}</span>
        <span>{headline(top.amountMinor / total, categoryLabel(top.categoryId))}</span>
      </p>

      <div className="fun-stack" role="list" aria-label={t('Reparto del gasto por familia')}>
        {fam.map((x, i) => (
          <Link
            key={x.f.id} role="listitem" className={`fun-seg ${x.f.darkText ? 'dark-text' : ''}`}
            style={{ flex: `${x.amount} 1 0`, background: x.f.color, '--i': i } as CSSProperties}
            to={`/movimientos?cat=${x.cats.map((c) => c.categoryId).join(',')}`}
            aria-label={`${x.f.label}: ${money(x.amount, o.currency, 0)}, ${pct(x.amount / total)}`}
          >
            {x.amount / total >= 0.14 ? pct(x.amount / total) : ''}
          </Link>
        ))}
      </div>

      <div className="fun-rows">
        {o.expenseByCategory.slice(0, limit).map((c, i) => {
          const color = familyOf(c.categoryId).color;
          const ch = c.prevAmountMinor > 0 ? (c.amountMinor - c.prevAmountMinor) / c.prevAmountMinor : null;
          return (
            <Link
              key={c.categoryId} className="fun-row" to={`/movimientos?cat=${c.categoryId}`}
              style={{ '--i': i, '--c': color, '--w': c.amountMinor / maxCat } as CSSProperties}
              aria-label={t('Ver los movimientos de {name}', { name: categoryLabel(c.categoryId) })}
            >
              <span className="fun-emoji" aria-hidden="true">{categoryEmoji(c.categoryId)}</span>
              <span className="fun-main">
                <span className="fun-name">
                  <span>{categoryLabel(c.categoryId)}</span>
                  {i === 0 && <span className="fun-crown" role="img" aria-label={t('Tu nº 1 de gasto')}>👑</span>}
                </span>
                <span className="fun-track" aria-hidden="true"><i /></span>
                <span className="fun-sub">
                  {t('{pct} del gasto', { pct: pct(c.share) })}
                  {ch !== null && Math.abs(ch) >= 0.1 && (
                    <span className={`fun-delta ${ch > 0 ? 'up' : 'down'}`}>
                      {ch > 0 ? '▲ ' : '▼ '}{t('{pct} vs {month}', { pct: pct(Math.abs(ch)), month: prevLabel })}
                    </span>
                  )}
                </span>
              </span>
              <Amount minor={c.amountMinor} currency={o.currency} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

import type { Overview } from '@econsultor/shared';
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { useId, useMemo, useState } from 'react';
import { Tip, useWidth, type TipState } from '../components/ui';
import { FAMILIES, categoryLabel, familyOf } from '../lib/categories';
import { money, pct } from '../lib/format';

interface N { id: string; name: string; color: string; col: 'src' | 'hub' | 'dst' }
interface L { source: string; target: string; value: number; color: string }
type SN = SankeyNode<N, L>;
type SL = SankeyLink<N, L>;

/**
 * "El río de tu dinero": de dónde entra (ingresos), por dónde pasa y a dónde va (familias de gasto + ahorro).
 * Si gastas más de lo que ingresas, el desfase aparece como un afluente "Déficit".
 */
export function FlowRiver({ o }: { o: Overview }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const gid = useId();
  const narrow = w < 520;

  const graph = useMemo(() => {
    const income = o.totals.incomeMinor;
    const expense = o.totals.expenseMinor;
    if (income <= 0 && expense <= 0) return null;

    const nodes: N[] = [];
    const links: L[] = [];
    const hub: N = { id: 'hub', name: 'Ingresos', color: 'var(--income)', col: 'hub' };

    if (narrow || o.incomeByCategory.length <= 1) {
      // en pantallas estrechas el propio hub es el origen
      hub.col = 'src';
    } else {
      for (const c of o.incomeByCategory) {
        nodes.push({ id: `in:${c.categoryId}`, name: categoryLabel(c.categoryId), color: 'var(--income)', col: 'src' });
        links.push({ source: `in:${c.categoryId}`, target: 'hub', value: c.amountMinor, color: 'var(--income)' });
      }
    }
    nodes.push(hub);
    if (expense > income) {
      hub.col = 'hub'; // con afluente de déficit el hub ya no es la primera columna
      nodes.push({ id: 'deficit', name: 'Déficit', color: 'var(--crit)', col: 'src' });
      links.push({ source: 'deficit', target: 'hub', value: expense - income, color: 'var(--crit)' });
    }
    const byFamily = new Map<string, number>();
    for (const c of o.expenseByCategory) {
      const f = familyOf(c.categoryId);
      byFamily.set(f.id, (byFamily.get(f.id) ?? 0) + c.amountMinor);
    }
    for (const f of FAMILIES) {
      const v = byFamily.get(f.id);
      if (!v) continue;
      nodes.push({ id: `out:${f.id}`, name: f.label, color: f.color, col: 'dst' });
      links.push({ source: 'hub', target: `out:${f.id}`, value: v, color: f.color });
    }
    if (income > expense) {
      nodes.push({ id: 'saved', name: 'Te sobra', color: 'var(--balance)', col: 'dst' });
      links.push({ source: 'hub', target: 'saved', value: income - expense, color: 'var(--balance)' });
    }
    return { nodes, links, total: Math.max(income, expense) };
  }, [o, narrow]);

  if (!graph) return <p className="muted">Anota ingresos y gastos para ver cómo fluye tu dinero.</p>;

  const dstCount = graph.nodes.filter((n) => n.col === 'dst').length;
  const H = Math.min(440, Math.max(230, dstCount * 46 + 20));
  const ML = narrow ? 64 : 96;
  const MR = narrow ? 100 : 118;
  const iw = Math.max(80, w - ML - MR);

  const layout = sankey<N, L>()
    .nodeId((n) => n.id)
    .nodeWidth(10)
    .nodePadding(26)
    .nodeSort(null)
    .extent([[0, 4], [iw, H - 4]]);
  const { nodes, links } = layout({
    nodes: graph.nodes.map((n) => ({ ...n })),
    links: graph.links.map((l) => ({ ...l })),
  });

  const path = sankeyLinkHorizontal<N, L>();
  const show = (e: React.PointerEvent, title: string, rows: TipState['rows']) => {
    const r = ref.current!.getBoundingClientRect();
    setTip({ x: Math.min(Math.max(e.clientX - r.left, 110), Math.max(110, r.width - 110)), y: Math.max(e.clientY - r.top, 50), title, rows });
  };
  const share = (v: number) => pct(v / Math.max(1, o.totals.incomeMinor || graph.total));

  return (
    <div className="chart" ref={ref} style={{ height: H }}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Diagrama de flujo de ingresos a gastos y ahorro. Consulta la vista de tabla para ver los importes.">
          <defs>
            {(links as SL[]).map((l, i) => (
              <linearGradient key={i} id={`${gid}-g${i}`} gradientUnits="userSpaceOnUse" x1={(l.source as SN).x1} x2={(l.target as SN).x0}>
                <stop offset="0" stopColor={(l.source as SN).color} />
                <stop offset="1" stopColor={(l.target as SN).color} />
              </linearGradient>
            ))}
          </defs>
          <g transform={`translate(${ML},0)`}>
            <g fill="none" className="fade-in">
              {(links as SL[]).map((l, i) => {
                const s = l.source as SN, t = l.target as SN;
                const id = `${s.id}>${t.id}`;
                const active = hover === null || hover === id || hover === s.id || hover === t.id;
                return (
                  <path
                    key={id}
                    d={path(l) ?? ''}
                    stroke={`url(#${gid}-g${i})`}
                    strokeWidth={Math.max(1.5, l.width ?? 1)}
                    strokeOpacity={active ? 0.5 : 0.12}
                    style={{ transition: 'stroke-opacity .15s' }}
                    onPointerEnter={() => setHover(id)}
                    onPointerMove={(e) => show(e, `${s.name} → ${t.name}`, [{ color: t.color, label: share(l.value), value: money(l.value, o.currency, 0) }])}
                    onPointerLeave={() => { setHover(null); setTip(null); }}
                  />
                );
              })}
            </g>
            {(nodes as SN[]).map((n) => {
              const y0 = n.y0 ?? 0, y1 = n.y1 ?? 0, x0 = n.x0 ?? 0, x1 = n.x1 ?? 0;
              const left = n.col === 'src' || (n.col === 'hub' && false);
              const showLabel = n.col !== 'hub';
              const cy = (y0 + y1) / 2;
              return (
                <g
                  key={n.id}
                  tabIndex={0}
                  role="img"
                  aria-label={`${n.name}: ${money(n.value ?? 0, o.currency, 0)}`}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerMove={(e) => show(e, n.name, [{ color: n.color, label: share(n.value ?? 0), value: money(n.value ?? 0, o.currency, 0) }])}
                  onPointerLeave={() => { setHover(null); setTip(null); }}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                >
                  <rect x={x0} y={y0} width={x1 - x0} height={Math.max(2, y1 - y0)} rx={4} fill={n.color} />
                  {showLabel && (
                    <text x={left ? x0 - 8 : x1 + 8} y={cy} textAnchor={left ? 'end' : 'start'}>
                      <tspan className="t-2" x={left ? x0 - 8 : x1 + 8} dy="-0.2em">{n.name}</tspan>
                      <tspan className="t-strong" x={left ? x0 - 8 : x1 + 8} dy="1.25em">{money(n.value ?? 0, o.currency, 0)}</tspan>
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}
      <Tip tip={tip} />
    </div>
  );
}

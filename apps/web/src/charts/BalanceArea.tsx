import type { Overview } from '@econsultor/shared';
import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import { useId, useMemo, useState } from 'react';
import { Tip, useWidth, type TipState } from '../components/ui';
import { dayLong, money, moneyShort } from '../lib/format';

const H = 240;
const M = { l: 46, r: 70, t: 16, b: 26 };

/** Saldo acumulado del mes (línea + lavado) y previsión de cierre (trazo discontinuo). */
export function BalanceArea({ o }: { o: Overview }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const dim = o.forecast.daysInMonth;
  const dayOf = (date: string) => Number(date.slice(8, 10));

  const geo = useMemo(() => {
    const actual = o.daily.map((d) => ({ day: dayOf(d.date), v: d.balanceMinor }));
    const proj = o.forecast.projectedBalance.map((d) => ({ day: dayOf(d.date), v: d.balanceMinor }));
    const all = [...actual, ...proj].map((p) => p.v);
    const lo = Math.min(0, ...all);
    const hi = Math.max(0, ...all);
    const pad = (hi - lo || 100_00) * 0.08;
    return { actual, proj, lo: lo < 0 ? lo - pad : 0, hi: hi + pad };
  }, [o]);

  if (!geo.actual.length) return <p className="muted">Todavía no hay movimientos en este mes.</p>;

  const iw = Math.max(10, w - M.l - M.r);
  const ih = H - M.t - M.b;
  const x = scaleLinear().domain([1, dim]).range([0, iw]);
  const y = scaleLinear().domain([geo.lo, geo.hi]).range([ih, 0]).nice(4);
  const ticks = y.ticks(4);
  const ln = line<{ day: number; v: number }>().x((p) => x(p.day)).y((p) => y(p.v)).curve(curveMonotoneX);
  const ar = area<{ day: number; v: number }>().x((p) => x(p.day)).y0(y(Math.max(y.domain()[0]!, Math.min(0, y.domain()[1]!)))).y1((p) => y(p.v)).curve(curveMonotoneX);

  const last = geo.actual[geo.actual.length - 1]!;
  const projEnd = geo.proj[geo.proj.length - 1];
  const xt = [1, Math.round(dim * 0.25), Math.round(dim * 0.5), Math.round(dim * 0.75), dim];

  const dayData = (day: number) => {
    const a = o.daily.find((d) => dayOf(d.date) === day);
    if (a) return { kind: 'real' as const, date: a.date, balance: a.balanceMinor, income: a.incomeMinor, expense: a.expenseMinor };
    const p = o.forecast.projectedBalance.find((d) => dayOf(d.date) === day);
    return p ? { kind: 'proj' as const, date: p.date, balance: p.balanceMinor, income: 0, expense: 0 } : null;
  };

  const maxDay = projEnd ? projEnd.day : last.day;
  const setFromX = (clientX: number, el: SVGElement) => {
    const r = el.getBoundingClientRect();
    const day = Math.round(x.invert(clientX - r.left));
    setHover(Math.min(maxDay, Math.max(1, day)));
  };

  let tip: TipState | null = null;
  const hd = hover ? dayData(hover) : null;
  if (hover && hd) {
    tip = {
      x: M.l + x(hover),
      y: M.t + y(hd.balance),
      title: dayLong(hd.date),
      rows:
        hd.kind === 'real'
          ? [
              { color: 'var(--balance)', label: 'Saldo del mes', value: money(hd.balance, o.currency, 0) },
              ...(hd.income ? [{ color: 'var(--income)', label: 'Ingresos', value: money(hd.income, o.currency, 0) }] : []),
              ...(hd.expense ? [{ color: 'var(--expense)', label: 'Gastos', value: money(hd.expense, o.currency, 0) }] : []),
            ]
          : [{ color: 'var(--balance)', label: 'Saldo previsto', value: money(hd.balance, o.currency, 0) }],
    };
  }

  return (
    <div className="chart" ref={ref} style={{ height: H }}>
      {w > 0 && (
        <svg
          width={w}
          height={H}
          role="img"
          tabIndex={0}
          aria-label={`Saldo del mes. Hoy ${money(last.v, o.currency, 0)}${projEnd ? `, previsión a fin de mes ${money(projEnd.v, o.currency, 0)}` : ''}. Usa las flechas para recorrer los días.`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((h) => Math.min(maxDay, (h ?? 0) + 1));
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(1, (h ?? maxDay + 1) - 1));
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`${gid}-wash`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--balance)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--balance)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform={`translate(${M.l},${M.t})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'axis-line' : 'grid-line'} x1={0} x2={iw} y1={y(t)} y2={y(t)} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end">{moneyShort(t, o.currency)}</text>
              </g>
            ))}
            {xt.map((d) => (
              <text key={d} x={x(d)} y={ih + 18} textAnchor="middle">{d}</text>
            ))}

            <path className="fade-in" d={ar(geo.actual) ?? ''} fill={`url(#${gid}-wash)`} />
            <path className="draw" pathLength={1} d={ln(geo.actual) ?? ''} fill="none" stroke="var(--balance)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {geo.proj.length > 1 && (
              <path className="fade-in" d={ln(geo.proj) ?? ''} fill="none" stroke="var(--balance)" strokeOpacity={0.7} strokeWidth={2} strokeDasharray="1 6" strokeLinecap="round" />
            )}

            {/* Punto de "hoy" con anillo de superficie */}
            <circle cx={x(last.day)} cy={y(last.v)} r={6} fill="var(--balance)" stroke="var(--surface)" strokeWidth={2} />
            {projEnd && <circle className="fade-in" cx={x(projEnd.day)} cy={y(projEnd.v)} r={5} fill="var(--surface)" stroke="var(--balance)" strokeWidth={2} />}

            {/* Etiquetas directas: solo extremos con historia */}
            <text className="t-strong" x={Math.min(x(last.day), iw - 4)} y={y(last.v) - 14} textAnchor="end">
              Hoy {money(last.v, o.currency, 0)}
            </text>
            {projEnd && (
              <g className="fade-in">
                <text className="t-strong" x={x(projEnd.day) + 10} y={y(projEnd.v) - 2}>{moneyShort(projEnd.v, o.currency)}</text>
                <text x={x(projEnd.day) + 10} y={y(projEnd.v) + 12}>previsto</text>
              </g>
            )}

            {hover && hd && (
              <g>
                <line className="axis-line" x1={x(hover)} x2={x(hover)} y1={0} y2={ih} />
                <circle cx={x(hover)} cy={y(hd.balance)} r={5} fill="var(--balance)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}
            <rect
              x={0} y={0} width={iw} height={ih} fill="transparent"
              onPointerMove={(e) => setFromX(e.clientX, e.currentTarget)}
              onPointerDown={(e) => setFromX(e.clientX, e.currentTarget)}
              onPointerLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}
      <Tip tip={tip} />
    </div>
  );
}

export function BalanceLegend() {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--balance)' }} />Saldo real</span>
      <span><i style={{ background: 'repeating-linear-gradient(90deg, var(--balance) 0 2px, transparent 2px 6px)' }} />Previsión de cierre</span>
    </div>
  );
}

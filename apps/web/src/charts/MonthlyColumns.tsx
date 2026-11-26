import type { Overview } from '@econsultor/shared';
import { scaleLinear } from 'd3-scale';
import { useState } from 'react';
import { Tip, useWidth, type TipState } from '../components/ui';
import { money, moneyShort, monthLabel, monthShort } from '../lib/format';
import { t } from '../lib/i18n';

const H = 220;
const M = { l: 44, r: 6, t: 14, b: 26 };

/** Columna con el extremo superior redondeado (4 px) y la base recta, anclada a la línea base. */
function colPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function MonthlyColumns({ o, onSelect }: { o: Overview; onSelect: (m: string) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const max = Math.max(1, ...o.monthly.flatMap((m) => [m.incomeMinor, m.expenseMinor]));
  const iw = Math.max(10, w - M.l - M.r);
  const ih = H - M.t - M.b;
  const y = scaleLinear().domain([0, max]).range([ih, 0]).nice(4);
  const ticks = y.ticks(4);
  const gw = iw / o.monthly.length;
  const bw = Math.min(14, Math.max(5, gw * 0.3));

  const show = (i: number, x: number) => {
    const m = o.monthly[i]!;
    setTip({
      x: M.l + x,
      y: M.t + y(Math.max(m.incomeMinor, m.expenseMinor)),
      title: monthLabel(m.month),
      rows: [
        { color: 'var(--income)', label: t('Ingresos'), value: money(m.incomeMinor, o.currency, 0) },
        { color: 'var(--expense)', label: t('Gastos'), value: money(m.expenseMinor, o.currency, 0) },
        { label: t('Balance'), value: money(m.incomeMinor - m.expenseMinor, o.currency, 0) },
      ],
    });
  };

  return (
    <>
      <div className="chart" ref={ref} style={{ height: H }}>
        {w > 0 && (
          <svg width={w} height={H} role="group" aria-label={t('Ingresos y gastos de los últimos 12 meses')}>
            <g transform={`translate(${M.l},${M.t})`}>
              {ticks.map((t) => (
                <g key={t}>
                  <line className={t === 0 ? 'axis-line' : 'grid-line'} x1={0} x2={iw} y1={y(t)} y2={y(t)} />
                  <text x={-8} y={y(t)} dy="0.32em" textAnchor="end">{moneyShort(t, o.currency)}</text>
                </g>
              ))}
              {o.monthly.map((m, i) => {
                const cx = i * gw + gw / 2;
                const selected = m.month === o.month;
                const hi = y(m.incomeMinor);
                const he = y(m.expenseMinor);
                return (
                  <g
                    key={m.month}
                    tabIndex={0}
                    role="button"
                    aria-label={t('{month}: ingresos {income}, gastos {expense}. Pulsa para abrir este mes.', { month: monthLabel(m.month), income: money(m.incomeMinor, o.currency, 0), expense: money(m.expenseMinor, o.currency, 0) })}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    onPointerEnter={() => show(i, cx)}
                    onPointerLeave={() => setTip(null)}
                    onFocus={() => { setFocus(m.month); show(i, cx); }}
                    onBlur={() => { setFocus(null); setTip(null); }}
                    onClick={() => onSelect(m.month)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(m.month))}
                  >
                    {(selected || focus === m.month) && <rect x={i * gw + 2} y={-6} width={gw - 4} height={ih + 30} rx={10} fill="var(--surface-2)" />}
                    <rect x={i * gw} y={-6} width={gw} height={ih + 34} fill="transparent" />
                    <path className="grow" style={{ animationDelay: `${i * 35}ms` }} d={colPath(cx - bw - 1, hi, bw, ih - hi)} fill="var(--income)" />
                    <path className="grow" style={{ animationDelay: `${i * 35 + 20}ms` }} d={colPath(cx + 1, he, bw, ih - he)} fill="var(--expense)" />
                    <text className={selected ? 't-strong' : ''} x={cx} y={ih + 18} textAnchor="middle">{monthShort(m.month)}</text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <Tip tip={tip} />
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--income)' }} />{t('Ingresos')}</span>
        <span><i style={{ background: 'var(--expense)' }} />{t('Gastos')}</span>
      </div>
    </>
  );
}

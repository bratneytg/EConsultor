import type { Overview } from '@econsultor/shared';
import { quantile } from 'd3-array';
import { useMemo, useState } from 'react';
import { Tip, useWidth, type TipState } from '../components/ui';
import { WEEKDAYS_SHORT, dayLong, money, monthShort } from '../lib/format';

const LEVELS = ['var(--h0)', 'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)'];
const weekdayMon0 = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Mapa de calor de gasto diario de las últimas 17 semanas (azul secuencial, un solo matiz). */
export function HeatCalendar({ o }: { o: Overview }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);

  const { cols, thresholds, offset } = useMemo(() => {
    const vals = o.heatmap.map((d) => d.expenseMinor).filter((v) => v > 0).sort((a, b) => a - b);
    const th = [0.25, 0.5, 0.75].map((p) => quantile(vals, p) ?? 0);
    const off = weekdayMon0(o.heatmap[0]!.date);
    return { cols: Math.ceil((o.heatmap.length + off) / 7), thresholds: th, offset: off };
  }, [o.heatmap]);

  const LEFT = 18;
  const TOP = 18;
  const gap = 3;
  const cell = Math.max(8, Math.min(22, Math.floor((w - LEFT - gap * (cols - 1)) / cols)));
  const level = (v: number): number => (v <= 0 ? 0 : v <= thresholds[0]! ? 1 : v <= thresholds[1]! ? 2 : v <= thresholds[2]! ? 3 : 4);

  const monthMarks: { col: number; label: string }[] = [];
  let lastMonth = '';
  o.heatmap.forEach((d, i) => {
    const col = Math.floor((i + offset) / 7);
    const m = d.date.slice(0, 7);
    if (m !== lastMonth && weekdayMon0(d.date) < 4 && !monthMarks.some((x) => x.col === col)) {
      monthMarks.push({ col, label: monthShort(m) });
      lastMonth = m;
    } else if (m !== lastMonth) lastMonth = m;
  });

  const height = TOP + 7 * (cell + gap);
  return (
    <>
      <div className="chart" ref={ref} style={{ height }}>
        {w > 0 && (
          <svg width={w} height={height} role="img" aria-label="Mapa de calor del gasto diario de las últimas 17 semanas">
            {WEEKDAYS_SHORT.map((l, r) => (
              r % 2 === 0 ? <text key={l} x={0} y={TOP + r * (cell + gap) + cell / 2} dy="0.34em">{l}</text> : null
            ))}
            {monthMarks.map((m) => (
              <text key={m.col} x={LEFT + m.col * (cell + gap)} y={10}>{m.label}</text>
            ))}
            {o.heatmap.map((d, i) => {
              const col = Math.floor((i + offset) / 7);
              const row = (i + offset) % 7;
              const x = LEFT + col * (cell + gap);
              const y = TOP + row * (cell + gap);
              return (
                <rect
                  key={d.date}
                  x={x} y={y} width={cell} height={cell} rx={Math.min(5, cell / 3)}
                  fill={LEVELS[level(d.expenseMinor)]}
                  tabIndex={-1}
                  className="fade-in"
                  style={{ animationDelay: `${col * 22}ms` }}
                  onPointerEnter={() => setTip({ x: x + cell / 2, y: y, title: dayLong(d.date), rows: [{ label: 'Gasto', value: d.expenseMinor ? money(d.expenseMinor, o.currency, 0) : 'Sin gastos' }] })}
                  onPointerLeave={() => setTip(null)}
                />
              );
            })}
          </svg>
        )}
        <Tip tip={tip} />
      </div>
      <div className="legend" style={{ alignItems: 'center' }}>
        <span style={{ gap: 4 }}>
          Menos
          {LEVELS.map((c) => <i key={c} className="sw" style={{ background: c, width: 12, height: 12 }} />)}
          Más
        </span>
      </div>
    </>
  );
}

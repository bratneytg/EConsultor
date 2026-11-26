import type { Overview } from '@econsultor/shared';
import { scaleLinear } from 'd3-scale';
import { useState } from 'react';
import { Tip, useWidth, type TipState } from '../components/ui';
import { money, weekdaysLong, weekdaysShort } from '../lib/format';
import { t } from '../lib/i18n';

const H = 170;
const M = { t: 24, b: 24 };

export function WeekdayBars({ o }: { o: Overview }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const LONG = weekdaysLong();
  const SHORT = weekdaysShort();
  const [tip, setTip] = useState<TipState | null>(null);
  const max = Math.max(1, ...o.weekday.map((d) => d.avgExpenseMinor));
  const top = o.weekday.reduce((a, b) => (b.avgExpenseMinor > a.avgExpenseMinor ? b : a));
  const ih = H - M.t - M.b;
  const y = scaleLinear().domain([0, max]).range([ih, 0]);
  const gw = w / 7;
  const bw = Math.min(24, gw * 0.5);

  return (
    <>
      <p className="sub" style={{ marginBottom: 6 }}>
        {top.avgExpenseMinor > 0 ? <>{t('Gastas más los')} <b>{LONG[top.weekday]}</b>: {t('unos {amount} de media.', { amount: money(top.avgExpenseMinor, o.currency, 0) })}</> : t('Aún no hay datos suficientes.')}
      </p>
      <div className="chart" ref={ref} style={{ height: H }}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label={t('Gasto medio por día de la semana')}>
            <line className="axis-line" x1={0} x2={w} y1={M.t + ih} y2={M.t + ih} />
            {o.weekday.map((d) => {
              const cx = d.weekday * gw + gw / 2;
              const hh = ih - y(d.avgExpenseMinor);
              const isTop = d.weekday === top.weekday && d.avgExpenseMinor > 0;
              const show = () => setTip({ x: cx, y: M.t + y(d.avgExpenseMinor), title: LONG[d.weekday], rows: [{ color: 'var(--expense)', label: t('Gasto medio'), value: money(d.avgExpenseMinor, o.currency, 0) }] });
              return (
                <g key={d.weekday} tabIndex={0} role="img" aria-label={`${LONG[d.weekday]}: ${money(d.avgExpenseMinor, o.currency, 0)}`} style={{ outline: 'none' }} onPointerEnter={show} onPointerLeave={() => setTip(null)} onFocus={show} onBlur={() => setTip(null)}>
                  <rect x={d.weekday * gw} y={0} width={gw} height={H} fill="transparent" />
                  <path
                    className="grow"
                    style={{ animationDelay: `${d.weekday * 45}ms` }}
                    d={hh > 0 ? `M${cx - bw / 2},${M.t + ih}V${M.t + y(d.avgExpenseMinor) + 4}Q${cx - bw / 2},${M.t + y(d.avgExpenseMinor)} ${cx - bw / 2 + 4},${M.t + y(d.avgExpenseMinor)}H${cx + bw / 2 - 4}Q${cx + bw / 2},${M.t + y(d.avgExpenseMinor)} ${cx + bw / 2},${M.t + y(d.avgExpenseMinor) + 4}V${M.t + ih}Z` : ''}
                    fill="var(--expense)"
                    fillOpacity={isTop ? 1 : 0.5}
                  />
                  {isTop && <text className="t-strong" x={cx} y={M.t + y(d.avgExpenseMinor) - 8} textAnchor="middle">{money(d.avgExpenseMinor, o.currency, 0)}</text>}
                  <text className={isTop ? 't-strong' : ''} x={cx} y={H - 6} textAnchor="middle">{SHORT[d.weekday]}</text>
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} />
      </div>
    </>
  );
}

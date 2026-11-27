import type { Overview } from '@econsultor/shared';
import { useMemo, useState, type CSSProperties } from 'react';
import { dayLong, dayShort, money } from '../lib/format';
import { t } from '../lib/i18n';

const dayNum = (date: string): number => Number(date.slice(8, 10));

/**
 * «Tus días»: una barra por día del mes (lo que gastaste), con los días futuros como siluetas.
 * Las barras suben en ola al entrar; hoy late; el día más caro lleva una llama.
 * Toda la información está también en la lectura de abajo y en la vista de tabla.
 */
export function DayBars({ o }: { o: Overview }) {
  const [sel, setSel] = useState<number | null>(null);
  const dim = o.forecast.daysInMonth;
  const elapsed = o.daily.length;
  const isCurrent = o.month === o.today.slice(0, 7);
  const todayN = isCurrent ? elapsed : 0;
  const cur = o.currency;

  const info = useMemo(() => {
    const run = isCurrent ? o.forecast.dailyRunRateMinor : 0;
    // Escala: un día enorme (alquiler, un viaje…) no debe aplastar al resto, así que se recorta
    // por encima de ~1,6 veces el percentil 85 y esa barra lleva un corte.
    const vals = o.daily.map((d) => d.expenseMinor).filter((v) => v > 0).sort((a, b) => a - b);
    const p85 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.85))]! : 0;
    const top = vals.length ? vals[vals.length - 1]! : 0;
    const max = Math.max(1, run, Math.min(top, Math.round(p85 * 1.6)));
    let peak = -1;
    let peakV = 0;
    o.daily.forEach((d, i) => { if (d.expenseMinor > peakV) { peakV = d.expenseMinor; peak = i + 1; } });
    // «Sin gastar»: solo días ya terminados (hoy aún puede cambiar).
    const free = o.daily.filter((d, i) => d.expenseMinor === 0 && !(isCurrent && i + 1 === todayN)).length;
    const avg = elapsed > 0 ? Math.round(o.totals.expenseMinor / elapsed) : 0;
    return { run, max, peak, peakV, free, avg };
  }, [o, isCurrent, todayN, elapsed]);

  const peakDate = info.peak > 0 ? o.daily[info.peak - 1]!.date : null;
  const focus = sel ?? (todayN || null);

  const readout = (() => {
    if (focus == null) return <span>{t('Toca una barra para ver ese día')}</span>;
    const d = o.daily[focus - 1];
    if (!d) {
      const date = `${o.month}-${String(focus).padStart(2, '0')}`;
      return <span>{t('{day}: previsión de unos {amount}', { day: dayLong(date), amount: money(info.run, cur, 0) })}</span>;
    }
    if (sel == null && focus === todayN) {
      return <span>{d.expenseMinor > 0 ? t('Hoy llevas {amount} gastados', { amount: money(d.expenseMinor, cur, 0) }) : t('Hoy todavía no has gastado nada 🎉')}</span>;
    }
    return (
      <>
        <span>{d.expenseMinor > 0 ? t('{day}: gastaste {amount}', { day: dayLong(d.date), amount: money(d.expenseMinor, cur, 0) }) : t('{day}: no gastaste nada 😌', { day: dayLong(d.date) })}</span>
        {d.incomeMinor > 0 && <span className="extra">{t('Ese día entraron {amount} 💸', { amount: money(d.incomeMinor, cur, 0) })}</span>}
      </>
    );
  })();

  const move = (e: React.KeyboardEvent) => {
    const last = isCurrent ? dim : elapsed;
    if (e.key === 'ArrowRight') { e.preventDefault(); setSel((s) => Math.min(last, (s ?? todayN ?? 0) + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSel((s) => Math.max(1, (s ?? (todayN || last + 1)) - 1)); }
    if (e.key === 'Escape') setSel(null);
  };

  const showLabel = (day: number): boolean => {
    if (day === 1 || day === dim || day === todayN) return true;
    if (day % 5 !== 0 || dim - day < 2) return false;
    return !todayN || Math.abs(day - todayN) > 2;
  };

  return (
    <div className="fun-days-wrap">
      <div
        className="fun-days" role="group" tabIndex={0}
        aria-label={t('Gasto de cada día del mes. Usa las flechas para recorrer los días.')}
        onKeyDown={move} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setSel(null); }}
      >
        {Array.from({ length: dim }, (_, i) => {
          const day = i + 1;
          const d = o.daily[i];
          const ghost = !d;
          const v = d ? d.expenseMinor : info.run;
          const free = !!d && v === 0;
          const clipped = v > info.max;
          const h = ghost ? Math.max(8, (v / info.max) * 100) : free ? 0 : Math.min(100, Math.max(7, (v / info.max) * 100));
          const cls = ['fun-day', ghost && 'ghost', free && 'free', day === todayN && 'today', day === info.peak && 'peak', clipped && 'clipped', sel === day && 'on'].filter(Boolean).join(' ');
          const date = `${o.month}-${String(day).padStart(2, '0')}`;
          return (
            <button
              key={day} type="button" tabIndex={-1} className={cls}
              style={{ '--i': i, '--r': h / 100 } as CSSProperties}
              aria-label={ghost ? t('{day}: previsión de unos {amount}', { day: dayLong(date), amount: money(v, cur, 0) }) : free ? t('{day}: no gastaste nada 😌', { day: dayLong(date) }) : t('{day}: gastaste {amount}', { day: dayLong(date), amount: money(v, cur, 0) })}
              aria-pressed={focus === day}
              onClick={() => setSel((s) => (s === day ? null : day))}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') setSel(day); }}
            >
              <span className="col">
                {d && d.incomeMinor > 0 && <i className="inc" aria-hidden="true" />}
                <span className="bar" />
              </span>
              <em>{showLabel(day) ? day : ''}</em>
            </button>
          );
        })}
      </div>

      <p className="fun-readout" role="status" aria-live="polite">{readout}</p>

      <div className="legend fun-legend">
        <span><i className="k-bar" />{t('Gasto del día')}</span>
        {isCurrent && elapsed < dim && o.totals.expenseMinor > 0 && <span><i className="k-ghost" />{t('Previsión')}</span>}
        <span><i className="k-inc" />{t('Entró dinero')}</span>
      </div>

      {elapsed >= 3 && o.totals.expenseMinor > 0 && (
        <ul className="fun-stickers">
          {peakDate && (
            <li style={{ '--c': 'var(--s2)' } as CSSProperties}>
              <span className="em" aria-hidden="true">🔥</span>
              <span><b className="num">{money(info.peakV, cur, 0)}</b><small>{t('Tu día más caro: el {day}', { day: dayShort(peakDate) })}</small></span>
            </li>
          )}
          <li style={{ '--c': 'var(--s1)' } as CSSProperties}>
            <span className="em" aria-hidden="true">☕</span>
            <span><b className="num">{money(info.avg, cur, 0)}</b><small>{t('Gastas de media al día')}</small></span>
          </li>
          <li style={{ '--c': 'var(--s3)' } as CSSProperties}>
            <span className="em" aria-hidden="true">😌</span>
            <span><b className="num">{info.free}</b><small>{t('Días sin gastar')}</small></span>
          </li>
        </ul>
      )}
    </div>
  );
}

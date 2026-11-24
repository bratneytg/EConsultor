import { useEffect, useRef, useState, type ReactNode } from 'react';
import { categoryColor } from '../lib/categories';
import { moneyParts } from '../lib/format';
import { CATEGORY_ICON, Icon } from './Icon';

/** Tamaño del contenedor, para gráficas SVG responsivas. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** true en pantallas estrechas (móvil). */
export function useNarrow(max = 719): boolean {
  const q = `(max-width: ${max}px)`;
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function CatTile({ id }: { id: string }) {
  return (
    <span className="tile" style={{ ['--tile-c' as string]: categoryColor(id) }}>
      <Icon name={CATEGORY_ICON[id] ?? 'dots'} />
    </span>
  );
}

/** Cuenta hasta el valor con easing. Respeta `prefers-reduced-motion`. */
export function useCountUp(target: number, ms = 1100): number {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    const start = performance.now();
    const f0 = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 4);
      const cur = f0 + (target - f0) * e;
      setV(cur);
      from.current = cur;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function HeroMoney({ minor, currency }: { minor: number; currency: string }) {
  const v = useCountUp(minor);
  const p = moneyParts(Math.round(v), currency);
  return (
    <div className={`hero-figure num ${minor < 0 ? 'neg' : ''}`} aria-label={`${p.sign}${p.int}${p.dec} ${p.cur}`}>
      <span aria-hidden="true">{p.sign}{p.int}<small>{p.dec} {p.cur}</small></span>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Toast({ text }: { text: string | null }) {
  return text ? <div className="toast" role="status">{text}</div> : null;
}

export function Card({ title, subtitle, wide, actions, children, className = '' }: { title?: string; subtitle?: string; wide?: boolean; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${wide ? 'wide' : ''} ${className}`}>
      {title && (
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Tarjeta de gráfica con vista alternativa en tabla (accesibilidad: nada depende del hover). */
export function ChartCard(props: {
  title: string; subtitle?: string; wide?: boolean; refetching?: boolean;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      title={props.title}
      subtitle={props.subtitle}
      wide={props.wide}
      className={props.refetching ? 'refetching' : ''}
      actions={<button className="chip-btn" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? 'Ver gráfica' : 'Ver tabla'}</button>}
    >
      {asTable ? (
        <div className="table-wrap">
          <table className="data-table num">
            <thead><tr>{props.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{props.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        props.children
      )}
    </Card>
  );
}

export interface TipState { x: number; y: number; title?: string; rows: { color?: string; label: string; value: string }[] }

/** Tooltip genérico dentro de un contenedor `.chart` (posición relativa a él). */
export function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.title && <div className="tip-title">{tip.title}</div>}
      {tip.rows.map((r, i) => (
        <div className="tip-row" key={i}>
          <span>{r.color && <i style={{ background: r.color }} />}{r.label}</span>
          <b className="num">{r.value}</b>
        </div>
      ))}
    </div>
  );
}

/** Posición del puntero relativa al contenedor, acotada para que el tooltip no se salga. */
export function pointerIn(e: { clientX: number; clientY: number }, el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const x = Math.min(Math.max(e.clientX - r.left, 100), Math.max(100, r.width - 100));
  return { x, y: Math.max(e.clientY - r.top, 40) };
}

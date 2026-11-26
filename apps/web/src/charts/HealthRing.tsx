import type { HealthScore } from '@econsultor/shared';
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useCountUp } from '../components/ui';
import { t } from '../lib/i18n';

const STATUS: Record<HealthScore['label'], { color: string; ok: boolean }> = {
  Excelente: { color: 'var(--good)', ok: true },
  Sólida: { color: 'var(--good)', ok: true },
  'En construcción': { color: 'var(--warn)', ok: false },
  Atención: { color: 'var(--serious)', ok: false },
};

/** Anillo de "pulso financiero". El estado nunca depende solo del color: lleva icono y etiqueta. */
export function HealthRing({ health, size = 168 }: { health: HealthScore; size?: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  const n = Math.round(useCountUp(health.score, 1300));
  const st = STATUS[health.label];
  const r = 50 - 7;
  return (
    <div style={{ width: size, display: 'grid', justifyItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={t('Pulso financiero: {score} de 100, {label}', { score: health.score, label: t(health.label) })}>
          <circle cx={50} cy={50} r={r} fill="none" stroke="var(--grid)" strokeWidth={7} />
          <circle
            cx={50} cy={50} r={r} fill="none" stroke={st.color} strokeWidth={7} strokeLinecap="round"
            pathLength={100} strokeDasharray="100" strokeDashoffset={on ? 100 - health.score : 100}
            transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(.22,.7,.2,1)' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
          <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.3, letterSpacing: '-0.04em', lineHeight: 1 }}>{n}</div>
          <div className="muted" style={{ fontSize: 12 }}>{t('de 100')}</div>
        </div>
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
        <span style={{ color: st.color, display: 'inline-flex' }}><Icon name={st.ok ? 'check' : 'warn'} size={16} /></span>
        {t(health.label)}
      </div>
    </div>
  );
}

export function HealthParts({ health }: { health: HealthScore }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      {health.parts.map((p) => (
        <div key={p.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
            <span>{t(p.label)}</span>
            <span className="num muted">{p.value}/100</span>
          </div>
          <div className="rank-row" style={{ display: 'block', padding: 0 }}>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.value} aria-label={t(p.label)}>
              <i style={{ width: `${p.value}%`, background: p.value >= 60 ? 'var(--good)' : p.value >= 35 ? 'var(--warn)' : 'var(--serious)', transition: 'width 1s' }} />
            </div>
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{t(p.hint)}</p>
        </div>
      ))}
    </div>
  );
}

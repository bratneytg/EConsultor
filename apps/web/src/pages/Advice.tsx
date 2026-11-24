import type { Advice as AdviceItem } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { useShell } from '../components/Shell';
import { Card } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { money } from '../lib/format';
import { useAdvice, useAppConfig } from '../lib/queries';
import type { PublicUser } from '@econsultor/shared';

const SEV: Record<AdviceItem['severity'], { icon: IconName; label: string }> = {
  warn: { icon: 'warn', label: 'Atención' },
  tip: { icon: 'spark', label: 'Consejo' },
  win: { icon: 'trophy', label: 'Buen trabajo' },
  info: { icon: 'info', label: 'Para saber' },
};

export function Advice() {
  const user = useUser();
  const { setUser } = useAuth();
  const { toast } = useShell();
  const qc = useQueryClient();
  const { data, isPending, isFetching, isError } = useAdvice();
  const { data: cfg } = useAppConfig();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const fresh = await api<NonNullable<typeof data>>('/advice?refresh=1');
      qc.setQueryData(['advice'], fresh);
    } finally { setBusy(false); }
  };

  const goPremium = async () => {
    const u = await api<PublicUser>('/dev/plan', { method: 'POST', json: { plan: 'premium' } });
    setUser(u);
    await qc.invalidateQueries({ queryKey: ['advice'] });
    toast('Premium activado (modo demostración)');
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>Hechos a partir de tus números</p>
          <h1>Consejos</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {data && <span className={`badge ${user.plan === 'premium' ? 'premium' : ''}`}>{user.plan === 'premium' ? (data.source === 'ai' ? 'Premium · IA' : 'Premium') : 'Gratis'}</span>}
          {user.plan === 'premium' && <button className="chip-btn" disabled={busy || isFetching} onClick={refresh}><Icon name="refresh" size={14} /> Actualizar</button>}
        </div>
      </header>

      {isPending ? (
        <div className="loading-screen" style={{ minHeight: 240 }}><div className="pulse-dot" /></div>
      ) : isError || !data ? (
        <Card><div className="empty"><h3>No hemos podido generar tus consejos</h3><p>Vuelve a intentarlo en unos segundos.</p></div></Card>
      ) : (
        <div className="stack">
          {data.items.map((a) => {
            const s = SEV[a.severity];
            return (
              <article key={a.id} className="card advice">
                <div className={`sev ${a.severity}`}><Icon name={s.icon} /></div>
                <div>
                  <div className="muted" style={{ fontSize: 12.5, marginBottom: 2 }}>{s.label}{a.scope === 'specific' ? ' · para ti' : ''}</div>
                  <h3>{a.title}</h3>
                  <p>{a.body}</p>
                  {a.impactMinor ? <span className="impact">Impacto estimado: {money(a.impactMinor, user.currency, 0)}{a.kind === 'saving' && a.id === 'emergency-fund' ? '' : ' al mes'}</span> : null}
                </div>
              </article>
            );
          })}

          {data.lockedCount > 0 && (
            <article className="card locked">
              <Icon name="lock" size={26} />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '10px 0 6px' }}>{data.lockedCount} {data.lockedCount === 1 ? 'consejo más' : 'consejos más'} con Premium</h3>
              <p className="sub" style={{ maxWidth: '40ch', margin: '0 auto 16px' }}>Consejos con IA sobre cómo ahorrar más y aumentar tus ingresos, ajustados a tu historial.</p>
              {cfg?.demo ? <button className="btn btn-primary" onClick={goPremium}>Probar Premium (demo)</button> : <span className="badge">Próximamente</span>}
            </article>
          )}
          <p className="hint" style={{ textAlign: 'center', padding: '4px 12px 0' }}>EConsultor ofrece orientación general y no sustituye a un asesor financiero profesional.</p>
        </div>
      )}
    </div>
  );
}

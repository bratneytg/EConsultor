import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AdviceCard } from '../components/AdviceCard';
import { Icon } from '../components/Icon';
import { useShell } from '../components/Shell';
import { Card } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { useAdvice, useAppConfig } from '../lib/queries';
import type { PublicUser } from '@econsultor/shared';

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
        <>
          <div className="advice-grid">
            {data.items.map((a) => <AdviceCard key={a.id} a={a} currency={user.currency} />)}

            {data.lockedCount > 0 && (
              <article className="advice-card locked">
                <Icon name="lock" size={26} />
                <h3>{data.lockedCount} {data.lockedCount === 1 ? 'consejo más' : 'consejos más'} con Premium</h3>
                <p>Consejos con IA sobre cómo ahorrar más y aumentar tus ingresos, ajustados a tu historial.</p>
                {cfg?.demo ? <button className="btn btn-primary" onClick={goPremium}>Probar Premium (demo)</button> : <span className="badge">Próximamente</span>}
              </article>
            )}
          </div>
          <p className="hint" style={{ textAlign: 'center', padding: '16px 12px 0' }}>EConsultor ofrece orientación general y no sustituye a un asesor financiero profesional.</p>
        </>
      )}
    </div>
  );
}

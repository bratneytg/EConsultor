import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PublicUser } from '@econsultor/shared';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { t } from '../lib/i18n';
import { useBilling } from '../lib/queries';
import { Icon } from './Icon';
import { fmtDate, priceText, useCheckout } from './Premium';
import { useShell } from './Shell';
import { Card } from './ui';

/** Ajustes › Suscripción: en qué plan estás, cuándo se cobra y cómo cambiar la tarjeta, ver facturas o cancelar. */
export function SubscriptionCard() {
  const user = useUser();
  const { setUser } = useAuth();
  const { toast } = useShell();
  const qc = useQueryClient();
  const { data: b, refetch } = useBilling();
  const { busy: paying, start } = useCheckout();
  const [portalBusy, setPortalBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const waiting = useRef(false);

  // Al volver de Stripe, el aviso de pago puede tardar unos segundos: se consulta hasta que aparezca Premium.
  useEffect(() => {
    if (params.get('pago') !== 'ok' || waiting.current) return;
    waiting.current = true;
    setParams({}, { replace: true });
    toast(t('Pago recibido. Activando Premium…'));
    let alive = true;
    (async () => {
      for (let i = 0; i < 10 && alive; i++) {
        const u = await api<PublicUser>('/me').catch(() => null);
        if (u?.plan === 'premium') {
          setUser(u);
          await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['advice'] })]);
          toast(t('¡Premium activado!'));
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (alive) toast(t('El pago está tardando en confirmarse. Vuelve a abrir esta pantalla en un minuto.'));
    })();
    return () => { alive = false; };
  }, [params, setParams, toast, setUser, refetch, qc]);

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const { url } = await api<{ url: string }>('/billing/portal', { method: 'POST' });
      window.location.assign(url);
    } catch (e) { toast((e as Error).message); setPortalBusy(false); }
  };

  const sub = b?.subscription;
  const status = (() => {
    if (!sub) return '';
    const end = sub.renewsAt ? fmtDate(sub.renewsAt) : '';
    switch (sub.status) {
      case 'trialing': return sub.cancelAtPeriodEnd ? t('Prueba gratuita cancelada: no se cobrará nada. Termina el {date}.', { date: end }) : t('Prueba gratuita hasta el {date}; después se cobra cada mes.', { date: end });
      case 'active': return sub.cancelAtPeriodEnd ? t('Cancelada: sigue activa hasta el {date}.', { date: end }) : t('Activa. Próximo cobro el {date}.', { date: end });
      case 'past_due': return t('El último cobro ha fallado. Actualiza tu forma de pago para no perder Premium.');
      case 'incomplete': return t('Esperando la confirmación del pago.');
      default: return t('Tu suscripción ha terminado.');
    }
  })();

  const premium = user.plan === 'premium';
  return (
    <Card>
      <div className="card-head">
        <div>
          <h2>{t('Suscripción')}</h2>
          <p>{premium ? t('Tienes Premium: consejos escritos por IA y análisis a fondo mejorado.') : t('Plan gratuito: todo el análisis hecho en el servidor, sin límite de movimientos.')}</p>
        </div>
        <span className={`badge ${premium ? 'premium' : ''}`}>{premium ? t('Premium') : t('Gratis')}</span>
      </div>

      {sub && <p className="sub-status" role="status"><Icon name={sub.status === 'past_due' ? 'warn' : 'info'} size={16} /> {status}</p>}
      {premium && b && b.source !== 'subscription' && !sub && (
        <p className="sub-status"><Icon name="info" size={16} /> {b.source === 'everyone' ? t('Premium está activado para todas las cuentas por ahora.') : t('Tu administrador te ha activado Premium.')}</p>
      )}

      <div className="sub-actions">
        {sub?.canManage && <button className="btn" disabled={portalBusy} onClick={openPortal}>{portalBusy ? t('Abriendo…') : t('Cancelar o gestionar suscripción')}</button>}
        {!premium && b?.enabled && <button className="btn btn-primary" disabled={paying} onClick={start}>{paying ? t('Abriendo el pago…') : t('Pasarme a Premium · {price} al mes', { price: priceText(b) })}</button>}
        <Link className="btn btn-ghost" to="/premium">{t('Ver qué incluye cada plan')}</Link>
      </div>
      {sub?.canManage && <p className="hint">{t('Desde ahí puedes cambiar la tarjeta, descargar facturas y cancelar. Cancelar no es inmediato: sigues con Premium hasta el final del periodo pagado.')}</p>}
      {!premium && b && !b.enabled && <p className="hint">{t('Todavía no se puede pagar desde la app.')}</p>}
    </Card>
  );
}

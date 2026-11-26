import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BillingInfo } from '@econsultor/shared';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { locale, t } from '../lib/i18n';
import { Icon } from './Icon';
import { useShell } from './Shell';

/** «4,99 € al mes», con el precio que cobra Stripe. */
export const priceText = (b: Pick<BillingInfo, 'priceCents' | 'currency'>): string => money(b.priceCents, b.currency.toUpperCase(), b.priceCents % 100 === 0 ? 0 : 2);

export const fmtDate = (iso: string): string => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Lleva a la página de pago de Stripe. Devuelve `busy` mientras se prepara; si falla, avisa y se puede reintentar. */
export function useCheckout() {
  const { toast } = useShell();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/billing/checkout', { method: 'POST' });
      window.location.assign(url);
    } catch (e) {
      toast((e as Error).message || t('No se pudo abrir el pago. Inténtalo de nuevo.'));
      setBusy(false);
    }
  };
  return { busy, start };
}

/**
 * Invitación a pasarse a Premium para los sitios donde la cuenta gratuita se topa con algo de pago.
 * Siempre explica qué se gana y lleva a la página de suscripciones; nunca bloquea lo que ya es gratis.
 */
export function PremiumNudge({ title, text, variant = 'card', children }: { title: string; text: string; variant?: 'card' | 'panel'; children?: React.ReactNode }) {
  return (
    <aside className={variant === 'card' ? 'advice-card locked premium-nudge' : 'ai-consent premium-nudge'} aria-label={title}>
      {variant === 'card' ? <Icon name="spark" size={26} /> : null}
      {variant === 'card' ? <h3>{title}</h3> : <b><Icon name="spark" size={16} /> {title}</b>}
      <p>{text}</p>
      <div className="nudge-actions">
        <Link className="btn btn-primary" to="/premium">{t('Ver Premium')}</Link>
        {children}
      </div>
    </aside>
  );
}

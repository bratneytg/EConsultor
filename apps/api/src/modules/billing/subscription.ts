import { randomUUID } from 'node:crypto';
import type { Plan } from '@econsultor/shared';
import { clearAdviceCache } from '../advice/advisor.js';
import type { BillingRecord, Store, UserRecord } from '../../store/types.js';
import type { StripeEvent } from './stripe.js';

/** Estados de Stripe en los que la persona sigue teniendo Premium (past_due = cobro fallido, Stripe reintenta unos días). */
export const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);
export const isActiveStatus = (s: string | undefined): boolean => !!s && ACTIVE_STATUSES.has(s);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const idOf = (v: unknown): string | undefined => str(v) ?? str((v as { id?: unknown } | null)?.id);
const iso = (sec: unknown): string | undefined => (typeof sec === 'number' && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : undefined);

/** Stripe movió `current_period_end` de la suscripción a sus líneas en versiones nuevas de su API: se leen las dos. */
const periodEnd = (sub: Record<string, unknown>): string | undefined => {
  const items = (sub.items as { data?: Array<{ current_period_end?: unknown }> } | undefined)?.data;
  return iso(sub.current_period_end) ?? iso(items?.[0]?.current_period_end);
};

async function findUser(store: Store, userId: string | undefined, customerId: string | undefined): Promise<UserRecord | undefined> {
  if (userId) { const u = await store.users.byId(userId); if (u) return u; }
  if (customerId) return (await store.users.all()).find((u) => u.billing?.customerId === customerId);
  return undefined;
}

export type Applied = 'applied' | 'ignored';

/**
 * Aplica un aviso de Stripe (ya verificado) a la cuenta. Es idempotente: repetirlo no cambia nada, y un aviso más
 * viejo que el último aplicado se ignora (Stripe no garantiza el orden). El plan de la cuenta lo decide el estado
 * de la suscripción; un plan fijado a mano desde el panel (planOverride) sigue mandando.
 */
export async function applyStripeEvent(store: Store, ev: StripeEvent): Promise<Applied> {
  const obj = ev.data.object;

  if (ev.type === 'checkout.session.completed') {
    if (obj.mode !== 'subscription') return 'ignored';
    const user = await findUser(store, str(obj.client_reference_id), idOf(obj.customer));
    if (!user) return 'ignored';
    const b: BillingRecord = { ...(user.billing ?? {}) };
    b.customerId = idOf(obj.customer) ?? b.customerId;
    b.subscriptionId = b.subscriptionId ?? idOf(obj.subscription);
    user.billing = b;
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    return 'applied';
  }

  if (!/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) return 'ignored';
  const subId = str(obj.id);
  if (!subId) return 'ignored';
  const customerId = idOf(obj.customer);
  const user = await findUser(store, str((obj.metadata as { userId?: unknown } | undefined)?.userId), customerId);
  if (!user) return 'ignored';

  const prev = user.billing ?? {};
  if (prev.eventAt && ev.created < prev.eventAt) return 'ignored';

  const status = ev.type === 'customer.subscription.deleted' ? 'canceled' : (str(obj.status) ?? 'incomplete');
  const nowActive = isActiveStatus(status);
  // Una suscripción antigua que termina mientras hay otra vigente no debe quitarle Premium a la persona.
  if (prev.subscriptionId && prev.subscriptionId !== subId && isActiveStatus(prev.status) && !nowActive) return 'ignored';

  const antes: Plan = user.plan;
  user.billing = {
    customerId: customerId ?? prev.customerId,
    subscriptionId: subId,
    status,
    currentPeriodEnd: periodEnd(obj) ?? prev.currentPeriodEnd,
    cancelAtPeriodEnd: obj.cancel_at_period_end === true,
    eventAt: ev.created,
  };
  if (!user.planOverride) user.plan = nowActive ? 'premium' : 'free';
  user.updatedAt = new Date().toISOString();
  await store.users.update(user);
  clearAdviceCache(user.id);
  if (antes !== user.plan) {
    await store.audit.append({ id: randomUUID(), userId: user.id, type: 'subscription_changed', at: user.updatedAt, detail: `${antes}→${user.plan} (${status})` });
  }
  await store.flush(); // el panel lee el archivo de datos
  return 'applied';
}

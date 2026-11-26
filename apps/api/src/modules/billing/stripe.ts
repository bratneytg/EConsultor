import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../../config.js';

/**
 * Cliente mínimo de Stripe, sin librería: solo `fetch` y la clave secreta. Así no entra código de terceros que
 * maneje la clave de cobro, y se ve de un vistazo todo lo que la app le pide a Stripe.
 */
export class StripeError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

type Billing = NonNullable<Config['billing']>;

/** Stripe pide los parámetros como formulario: los objetos anidados se escriben a[b][c]=valor. */
export function toForm(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' && item !== null ? toForm(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') toForm(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call<T>(b: Billing, method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, unknown>): Promise<T> {
  const body = params && method === 'POST' ? toForm(params) : undefined;
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${b.secretKey}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new StripeError('No se pudo conectar con Stripe', 502, 'network');
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new StripeError(json.error?.message ?? 'Stripe rechazó la petición', res.status, json.error?.code);
  return json;
}

export interface CheckoutArgs { userId: string; email: string; customerId?: string; origin: string }

/** Crea la página de pago de Stripe para suscribirse. Devuelve su dirección. */
export async function createCheckoutSession(b: Billing, a: CheckoutArgs): Promise<string> {
  const s = await call<{ url?: string }>(b, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: b.priceId, quantity: 1 }],
    client_reference_id: a.userId,
    ...(a.customerId ? { customer: a.customerId } : { customer_email: a.email }),
    subscription_data: { metadata: { userId: a.userId }, ...(b.trialDays > 0 ? { trial_period_days: b.trialDays } : {}) },
    success_url: `${a.origin}/ajustes/suscripcion?pago=ok`,
    cancel_url: `${a.origin}/premium?pago=cancelado`,
    allow_promotion_codes: true,
    locale: 'auto',
    ...(b.automaticTax ? { automatic_tax: { enabled: true }, ...(a.customerId ? { customer_update: { address: 'auto' } } : {}) } : {}),
  });
  if (!s.url) throw new StripeError('Stripe no devolvió la página de pago', 502);
  return s.url;
}

/** Portal de Stripe: cambiar la tarjeta, ver facturas y cancelar. */
export async function createPortalSession(b: Billing, customerId: string, origin: string): Promise<string> {
  const s = await call<{ url?: string }>(b, 'POST', '/billing_portal/sessions', { customer: customerId, return_url: `${origin}/ajustes/suscripcion` });
  if (!s.url) throw new StripeError('Stripe no devolvió el portal', 502);
  return s.url;
}

/** Cancela una suscripción al momento (al borrar la cuenta). Si ya no existe, no es un error. */
export async function cancelSubscription(b: Billing, subscriptionId: string): Promise<void> {
  try {
    await call(b, 'DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  } catch (e) {
    if (e instanceof StripeError && (e.status === 404 || e.code === 'resource_missing')) return;
    throw e;
  }
}

// El precio se lee de Stripe (así nunca se enseña uno distinto del que se cobra) y se recuerda una hora.
let precio: { at: number; priceId: string; cents: number; currency: string } | null = null;
export async function readPrice(b: Billing, fallbackCents: number): Promise<{ cents: number; currency: string }> {
  if (precio && precio.priceId === b.priceId && Date.now() - precio.at < 3_600_000) return precio;
  try {
    const p = await call<{ unit_amount?: number | null; currency?: string }>(b, 'GET', `/prices/${encodeURIComponent(b.priceId)}`);
    if (typeof p.unit_amount === 'number' && p.unit_amount > 0) {
      precio = { at: Date.now(), priceId: b.priceId, cents: p.unit_amount, currency: (p.currency ?? 'eur').toLowerCase() };
      return precio;
    }
  } catch { /* se usa el precio de reserva */ }
  return { cents: fallbackCents, currency: 'eur' };
}
export const _olvidarPrecio = (): void => { precio = null; };

// ───────── Avisos (webhooks) ─────────
export interface StripeEvent { id: string; type: string; created: number; data: { object: Record<string, unknown> } }

/**
 * Comprueba la firma que Stripe pone en cada aviso: HMAC-SHA256 de «marca de tiempo.cuerpo» con el secreto del
 * webhook. Sin esto cualquiera podría hacerse Premium mandando un aviso falso. Rechaza avisos de hace más de 5 minutos.
 */
export function verifyWebhook(raw: Buffer, header: string | undefined, secret: string, nowMs = Date.now(), toleranceS = 300): StripeEvent | null {
  if (!header) return null;
  let t = '';
  const firmas: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') firmas.push(v);
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || firmas.length === 0) return null;
  if (Math.abs(nowMs / 1000 - ts) > toleranceS) return null;
  const esperada = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  const ok = firmas.some((f) => {
    if (!/^[0-9a-f]{64}$/i.test(f)) return false;
    return timingSafeEqual(esperada, Buffer.from(f, 'hex'));
  });
  if (!ok) return null;
  try {
    const ev = JSON.parse(raw.toString('utf8')) as StripeEvent;
    return ev && typeof ev.type === 'string' && ev.data?.object ? ev : null;
  } catch { return null; }
}

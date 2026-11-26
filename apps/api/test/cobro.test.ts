import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { _olvidarPrecio, toForm, verifyWebhook } from '../src/modules/billing/stripe.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const SECRET = 'whsec_prueba_1234567890';
const ENV = { NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_12345678901234567890', STRIPE_PRICE_ID: 'price_123', STRIPE_WEBHOOK_SECRET: SECRET, ADMIN_TOKEN: 'a'.repeat(64) };
const PASS = 'Xk9-mango-lluvia-77';

const firmar = (body: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const crear = async (env: Record<string, string> = ENV) => {
  const store = new FileStore({ file: null });
  const app = await buildApp(loadConfig(env as NodeJS.ProcessEnv), store);
  return { app, store };
};
const registrar = async (app: FastifyInstance) => {
  const email = `co${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'Cora' } });
  const { accessToken, user } = r.json() as { accessToken: string; user: { id: string } };
  return { email, id: user.id, h: { authorization: `Bearer ${accessToken}` } };
};
const me = async (app: FastifyInstance, h: Record<string, string>) => (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json() as { plan: string };
const aviso = (app: FastifyInstance, type: string, object: object, created = Math.floor(Date.now() / 1000), sig?: string) => {
  const body = JSON.stringify({ id: `evt_${Math.random()}`, type, created, data: { object } });
  return app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': sig ?? firmar(body) }, payload: body });
};
const sub = (userId: string, over: Record<string, unknown> = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, current_period_end: 1_900_000_000, metadata: { userId }, ...over });

afterEach(() => { vi.unstubAllGlobals(); _olvidarPrecio(); });

describe('Stripe: formulario y firma', () => {
  it('escribe los parámetros anidados como los espera Stripe', () => {
    const f = toForm({ mode: 'subscription', line_items: [{ price: 'p', quantity: 1 }], subscription_data: { metadata: { userId: 'u' } }, omitido: undefined });
    expect(f.get('mode')).toBe('subscription');
    expect(f.get('line_items[0][price]')).toBe('p');
    expect(f.get('line_items[0][quantity]')).toBe('1');
    expect(f.get('subscription_data[metadata][userId]')).toBe('u');
    expect(f.has('omitido')).toBe(false);
  });

  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: 1, data: { object: { id: 'sub_1' } } });
  it('acepta una firma correcta y rechaza las demás', () => {
    const ahora = Date.now();
    const t = Math.floor(ahora / 1000);
    expect(verifyWebhook(Buffer.from(body), firmar(body, SECRET, t), SECRET, ahora)?.type).toBe('customer.subscription.updated');
    expect(verifyWebhook(Buffer.from(body), firmar(body, 'otro_secreto_distinto', t), SECRET, ahora)).toBeNull();
    expect(verifyWebhook(Buffer.from(body + ' '), firmar(body, SECRET, t), SECRET, ahora)).toBeNull(); // cuerpo alterado
    expect(verifyWebhook(Buffer.from(body), undefined, SECRET, ahora)).toBeNull();
    expect(verifyWebhook(Buffer.from(body), 't=abc,v1=zz', SECRET, ahora)).toBeNull();
    expect(verifyWebhook(Buffer.from(body), `t=${t}`, SECRET, ahora)).toBeNull(); // sin v1
  });
  it('rechaza avisos antiguos (repetición de un aviso robado)', () => {
    const ahora = Date.now();
    const viejo = Math.floor(ahora / 1000) - 3600;
    expect(verifyWebhook(Buffer.from(body), firmar(body, SECRET, viejo), SECRET, ahora)).toBeNull();
  });
  it('acepta que Stripe mande varias firmas (rotación del secreto)', () => {
    const ahora = Date.now();
    const t = Math.floor(ahora / 1000);
    const buena = firmar(body, SECRET, t).split(',v1=')[1];
    expect(verifyWebhook(Buffer.from(body), `t=${t},v1=${'0'.repeat(64)},v1=${buena}`, SECRET, ahora)).not.toBeNull();
  });
});

describe('cuentas gratuitas por defecto y precio', () => {
  let app: FastifyInstance;
  beforeAll(async () => { ({ app } = await crear()); });
  afterAll(() => app.close());

  it('una cuenta nueva es gratuita', async () => {
    const { h } = await registrar(app);
    expect((await me(app, h)).plan).toBe('free');
  });

  it('GET /billing lee el precio de Stripe y avisa de que el cobro está activo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ unit_amount: 599, currency: 'EUR' }), { status: 200 })));
    const { h } = await registrar(app);
    const r = (await app.inject({ method: 'GET', url: '/api/billing', headers: h })).json() as Record<string, unknown>;
    expect(r).toMatchObject({ enabled: true, plan: 'free', source: 'none', priceCents: 599, currency: 'eur', trialDays: 0 });
    expect(r.subscription).toBeUndefined();
  });

  it('si Stripe no responde, enseña el precio de reserva', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red'); }));
    const { h } = await registrar(app);
    const r = (await app.inject({ method: 'GET', url: '/api/billing', headers: h })).json() as { priceCents: number };
    expect(r.priceCents).toBe(499);
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/billing' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/billing/checkout' })).statusCode).toBe(401);
  });
});

describe('pagar: página de Stripe', () => {
  let app: FastifyInstance;
  beforeAll(async () => { ({ app } = await crear({ ...ENV, PREMIUM_TRIAL_DAYS: '7' })); });
  afterAll(() => app.close());

  it('crea la sesión de pago con lo necesario y devuelve su dirección', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { h, id, email } = await registrar(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: h });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { url: string }).url).toContain('checkout.stripe.com');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const p = new URLSearchParams(String(init!.body));
    expect(p.get('mode')).toBe('subscription');
    expect(p.get('line_items[0][price]')).toBe('price_123');
    expect(p.get('client_reference_id')).toBe(id);
    expect(p.get('customer_email')).toBe(email);
    expect(p.get('subscription_data[metadata][userId]')).toBe(id);
    expect(p.get('subscription_data[trial_period_days]')).toBe('7');
    expect(p.get('success_url')).toContain('/ajustes/suscripcion?pago=ok');
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ENV.STRIPE_SECRET_KEY}`);
  });

  it('no deja pagar a quien ya tiene Premium', async () => {
    const { h, email } = await registrar(app);
    await app.inject({ method: 'POST', url: '/api/admin/plan', headers: { 'x-admin-token': ENV.ADMIN_TOKEN }, payload: { email, plan: 'premium' } });
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: h });
    expect(r.statusCode).toBe(409);
  });

  it('si Stripe falla, responde con un error claro (sin filtrar detalles)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'secreto interno' } }), { status: 500 })));
    const { h } = await registrar(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: h });
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toContain('secreto interno');
  });

  it('el portal exige haber pagado alguna vez', async () => {
    const { h } = await registrar(app);
    expect((await app.inject({ method: 'POST', url: '/api/billing/portal', headers: h })).statusCode).toBe(400);
  });
});

describe('sin cobro configurado', () => {
  let app: FastifyInstance;
  beforeAll(async () => { ({ app } = await crear({ NODE_ENV: 'test' })); });
  afterAll(() => app.close());

  it('se puede ver el plan pero no pagar, y el aviso de Stripe no existe', async () => {
    const { h } = await registrar(app);
    const b = (await app.inject({ method: 'GET', url: '/api/billing', headers: h })).json() as { enabled: boolean; priceCents: number };
    expect(b).toMatchObject({ enabled: false, priceCents: 499 });
    expect((await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: h })).statusCode).toBe(503);
    expect((await aviso(app, 'customer.subscription.created', sub('x'))).statusCode).toBe(404);
  });
});

describe('avisos de Stripe: dan y quitan Premium', () => {
  let app: FastifyInstance;
  beforeAll(async () => { ({ app } = await crear()); });
  afterAll(() => app.close());

  it('rechaza un aviso sin firma o con firma falsa, y no cambia nada', async () => {
    const { h, id } = await registrar(app);
    expect((await aviso(app, 'customer.subscription.created', sub(id), undefined, 't=1,v1=' + '0'.repeat(64))).statusCode).toBe(400);
    const cuerpo = JSON.stringify({ id: 'e', type: 'customer.subscription.created', created: 1, data: { object: sub(id) } });
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json' }, payload: cuerpo });
    expect(r.statusCode).toBe(400);
    expect((await me(app, h)).plan).toBe('free');
  });

  it('una suscripción activa da Premium y su cancelación lo quita', async () => {
    const { h, id } = await registrar(app);
    expect((await aviso(app, 'customer.subscription.created', sub(id), 1000)).statusCode).toBe(200);
    expect((await me(app, h)).plan).toBe('premium');
    const b = (await app.inject({ method: 'GET', url: '/api/billing', headers: h })).json() as { source: string; subscription: { status: string; canManage: boolean; renewsAt: string } };
    expect(b.source).toBe('subscription');
    expect(b.subscription).toMatchObject({ status: 'active', canManage: true });
    expect(b.subscription.renewsAt).toMatch(/^\d{4}-/);
    await aviso(app, 'customer.subscription.deleted', sub(id, { status: 'canceled' }), 2000);
    expect((await me(app, h)).plan).toBe('free');
  });

  it('el periodo de prueba y un cobro fallido mantienen Premium; el impago lo quita', async () => {
    const { h, id } = await registrar(app);
    await aviso(app, 'customer.subscription.created', sub(id, { status: 'trialing' }), 1000);
    expect((await me(app, h)).plan).toBe('premium');
    await aviso(app, 'customer.subscription.updated', sub(id, { status: 'past_due' }), 2000);
    expect((await me(app, h)).plan).toBe('premium');
    await aviso(app, 'customer.subscription.updated', sub(id, { status: 'unpaid' }), 3000);
    expect((await me(app, h)).plan).toBe('free');
  });

  it('no da Premium mientras el primer pago no se ha completado', async () => {
    const { h, id } = await registrar(app);
    await aviso(app, 'customer.subscription.created', sub(id, { status: 'incomplete' }), 1000);
    expect((await me(app, h)).plan).toBe('free');
  });

  it('ignora un aviso viejo que llega tarde y es idempotente', async () => {
    const { h, id } = await registrar(app);
    await aviso(app, 'customer.subscription.updated', sub(id, { status: 'canceled' }), 5000);
    await aviso(app, 'customer.subscription.updated', sub(id, { status: 'active' }), 4000); // anterior: se descarta
    expect((await me(app, h)).plan).toBe('free');
    await aviso(app, 'customer.subscription.updated', sub(id, { status: 'active' }), 6000);
    await aviso(app, 'customer.subscription.updated', sub(id, { status: 'active' }), 6000); // repetido
    expect((await me(app, h)).plan).toBe('premium');
  });

  it('cancelar al final del periodo mantiene Premium y lo indica', async () => {
    const { h, id } = await registrar(app);
    await aviso(app, 'customer.subscription.updated', sub(id, { cancel_at_period_end: true }), 1000);
    const b = (await app.inject({ method: 'GET', url: '/api/billing', headers: h })).json() as { plan: string; subscription: { cancelAtPeriodEnd: boolean } };
    expect(b.plan).toBe('premium');
    expect(b.subscription.cancelAtPeriodEnd).toBe(true);
  });

  it('encuentra la cuenta por el cliente de Stripe y lee el fin del periodo de las nuevas versiones de la API', async () => {
    const { h, id } = await registrar(app);
    await aviso(app, 'checkout.session.completed', { mode: 'subscription', client_reference_id: id, customer: 'cus_zz', subscription: 'sub_zz' }, 1000);
    const { current_period_end: _ignorado, ...resto } = sub('no-existe', { id: 'sub_zz', customer: 'cus_zz', items: { data: [{ current_period_end: 1_900_000_000 }] } });
    await aviso(app, 'customer.subscription.updated', resto, 2000); // sin metadata.userId: se busca por cliente
    expect((await me(app, h)).plan).toBe('premium');
    const b = (await app.inject({ method: 'GET', url: '/api/billing', headers: h })).json() as { subscription: { renewsAt: string } };
    expect(b.subscription.renewsAt).toBe(new Date(1_900_000_000 * 1000).toISOString());
  });

  it('un ajuste manual desde el panel manda sobre la suscripción', async () => {
    const { h, id, email } = await registrar(app);
    await app.inject({ method: 'POST', url: '/api/admin/plan', headers: { 'x-admin-token': ENV.ADMIN_TOKEN }, payload: { email, plan: 'free' } });
    await aviso(app, 'customer.subscription.created', sub(id), 1000);
    expect((await me(app, h)).plan).toBe('free');
  });

  it('una suscripción antigua que termina no quita Premium si hay otra vigente', async () => {
    const { h, id } = await registrar(app);
    await aviso(app, 'customer.subscription.created', sub(id, { id: 'sub_nueva' }), 2000);
    await aviso(app, 'customer.subscription.deleted', sub(id, { id: 'sub_vieja', status: 'canceled' }), 3000);
    expect((await me(app, h)).plan).toBe('premium');
  });

  it('un aviso de una cuenta desconocida se acepta sin hacer nada', async () => {
    expect((await aviso(app, 'customer.subscription.created', sub('nadie'), 1000)).statusCode).toBe(200);
    expect((await aviso(app, 'invoice.paid', { id: 'in_1' })).statusCode).toBe(200);
  });

  it('el resto de la API sigue leyendo JSON con normalidad', async () => {
    const { h } = await registrar(app);
    const r = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: h, payload: { displayName: 'Nuevo nombre' } });
    expect(r.statusCode).toBe(200);
  });
});

describe('borrar la cuenta cancela la suscripción', () => {
  let app: FastifyInstance;
  beforeAll(async () => { ({ app } = await crear()); });
  afterAll(() => app.close());

  it('la cancela en Stripe y luego borra', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { h, id, email } = await registrar(app);
    await aviso(app, 'customer.subscription.created', sub(id, { id: 'sub_borrar' }), 1000);
    const r = await app.inject({ method: 'DELETE', url: '/api/me', headers: h, payload: { confirmEmail: email, password: PASS } });
    expect(r.statusCode).toBe(200);
    expect(f.mock.calls[0]![0]).toBe('https://api.stripe.com/v1/subscriptions/sub_borrar');
    expect(f.mock.calls[0]![1]!.method).toBe('DELETE');
  });

  it('si Stripe no responde, no borra la cuenta (para no seguir cobrando)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('sin red'); }));
    const { h, id, email } = await registrar(app);
    await aviso(app, 'customer.subscription.created', sub(id, { id: 'sub_x' }), 1000);
    const r = await app.inject({ method: 'DELETE', url: '/api/me', headers: h, payload: { confirmEmail: email, password: PASS } });
    expect(r.statusCode).toBe(502);
    expect((await me(app, h)).plan).toBe('premium'); // la cuenta sigue ahí
  });

  it('una cuenta gratuita se borra sin tocar Stripe', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { h, email } = await registrar(app);
    expect((await app.inject({ method: 'DELETE', url: '/api/me', headers: h, payload: { confirmEmail: email, password: PASS } })).statusCode).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
});

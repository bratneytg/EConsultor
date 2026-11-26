import type { FastifyInstance } from 'fastify';
import type { BillingInfo } from '@econsultor/shared';
import { AppError, badRequest, conflict } from '../lib/errors.js';
import { effectivePlan } from '../lib/plan.js';
import { applyStripeEvent, isActiveStatus } from '../modules/billing/subscription.js';
import { StripeError, createCheckoutSession, createPortalSession, readPrice, verifyWebhook } from '../modules/billing/stripe.js';
import type { UserRecord } from '../store/types.js';

const stripeFail = (e: unknown): never => {
  if (e instanceof AppError) throw e;
  if (e instanceof StripeError) throw new AppError(502, 'stripe_error', 'No se pudo conectar con el sistema de pago. Inténtalo de nuevo en un momento.');
  throw e;
};

/** Cobro de Premium con Stripe: página de pago, portal para gestionar la suscripción y el aviso que confirma cada pago. */
export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };

  const sourceOf = (u: UserRecord): BillingInfo['source'] => {
    if (u.planOverride) return u.planOverride === 'premium' ? 'manual' : 'none';
    if (cfg.premiumForAll) return 'everyone';
    if (u.plan !== 'premium') return 'none';
    return isActiveStatus(u.billing?.status) ? 'subscription' : 'manual';
  };

  app.get('/', auth, async (req): Promise<BillingInfo> => {
    const u = req.user;
    const price = cfg.billing ? await readPrice(cfg.billing, cfg.premiumPriceCents) : { cents: cfg.premiumPriceCents, currency: 'eur' };
    const b = u.billing;
    return {
      enabled: !!cfg.billing,
      plan: effectivePlan(cfg, u),
      source: sourceOf(u),
      priceCents: price.cents,
      currency: price.currency,
      trialDays: cfg.billing?.trialDays ?? 0,
      ...(b?.subscriptionId || b?.customerId
        ? { subscription: { status: b.status ?? 'incomplete', renewsAt: b.currentPeriodEnd, cancelAtPeriodEnd: !!b.cancelAtPeriodEnd, canManage: !!b.customerId } }
        : {}),
    };
  });

  app.post('/checkout', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    if (!cfg.billing) throw new AppError(503, 'billing_disabled', 'El pago todavía no está disponible.');
    if (effectivePlan(cfg, req.user) === 'premium') throw conflict('Ya tienes Premium.', 'already_premium');
    try {
      const url = await createCheckoutSession(cfg.billing, { userId: req.user.id, email: req.user.email, customerId: req.user.billing?.customerId, origin: cfg.publicOrigin });
      return { url };
    } catch (e) { return stripeFail(e); }
  });

  app.post('/portal', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    if (!cfg.billing) throw new AppError(503, 'billing_disabled', 'El pago todavía no está disponible.');
    const customerId = req.user.billing?.customerId;
    if (!customerId) throw badRequest('Todavía no tienes ninguna suscripción.', 'no_customer');
    try { return { url: await createPortalSession(cfg.billing, customerId, cfg.publicOrigin) }; } catch (e) { return stripeFail(e); }
  });

  // El aviso de Stripe llega sin sesión: se autentica solo con la firma. Necesita el cuerpo tal cual (en bruto).
  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));
    hook.post('/webhook', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!cfg.billing) return reply.code(404).send({ error: 'not_found' });
      const sig = req.headers['stripe-signature'];
      const ev = Buffer.isBuffer(req.body) ? verifyWebhook(req.body, typeof sig === 'string' ? sig : undefined, cfg.billing.webhookSecret) : null;
      if (!ev) {
        req.log.warn({ ip: req.ip }, '[cobro] aviso con firma no válida');
        return reply.code(400).send({ error: 'invalid_signature' });
      }
      const r = await applyStripeEvent(store, ev);
      req.log.info({ type: ev.type, r }, '[cobro] aviso de Stripe');
      return { received: true };
    });
  });
}

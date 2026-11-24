import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isoDate, monthStr, settingsInput, transactionInput, type Transaction } from '@econsultor/shared';
import { addDays, monthOf, todayIn } from '../lib/dates.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { getAdvice, clearAdviceCache } from '../modules/advice/advisor.js';
import { buildOverview } from '../modules/analytics/analytics.js';
import { generateDemoTransactions } from '../modules/demo/seed.js';
import { verifyPassword } from '../security/password.js';
import { toPublicUser } from './auth.js';

/** Fecha de calendario real (rechaza 2026-02-31) y no más de 1 día en el futuro. */
function assertSaneDate(date: string, today: string): void {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw badRequest('Fecha inexistente', 'invalid_date');
  if (date > addDays(today, 1)) throw badRequest('No se pueden registrar movimientos en el futuro', 'future_date');
  if (date < '2000-01-01') throw badRequest('Fecha demasiado antigua', 'invalid_date');
}

const listQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(['income', 'expense']).optional(),
  categoryId: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };

  // ───────── Perfil de cuenta ─────────
  app.get('/me', auth, async (req) => toPublicUser(req.user));

  app.patch('/me/settings', auth, async (req) => {
    const body = settingsInput.parse(req.body);
    const u = req.user;
    if (body.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { throw badRequest('Zona horaria no válida'); }
      u.timezone = body.timezone;
    }
    if (body.displayName) u.displayName = body.displayName;
    if (body.currency) u.currency = body.currency;
    if (body.reminderEnabled !== undefined) u.reminderEnabled = body.reminderEnabled;
    if (body.reminderTime) u.reminderTime = body.reminderTime;
    if (body.uiMode) u.uiMode = body.uiMode;
    u.updatedAt = new Date().toISOString();
    await store.users.update(u);
    return toPublicUser(u);
  });

  app.get('/me/security', auth, async (req) => {
    const events = await store.audit.recent(req.user.id, 15);
    return { events: events.map((e) => ({ type: e.type, at: e.at, ip: e.ip, detail: e.detail })) };
  });

  /** Portabilidad de datos (RGPD art. 20). Nunca incluye secretos ni hashes. */
  app.get('/me/export', auth, async (req, reply) => {
    const txs = await store.transactions.list(req.user.id);
    reply.header('content-disposition', 'attachment; filename="econsultor-export.json"');
    return { exportedAt: new Date().toISOString(), user: toPublicUser(req.user), transactions: txs };
  });

  /** Derecho de supresión (RGPD art. 17). */
  app.delete('/me', auth, async (req, reply) => {
    const body = z.object({ confirmEmail: z.string(), password: z.string().max(128).optional() }).parse(req.body);
    const u = req.user;
    if (body.confirmEmail.trim().toLowerCase() !== u.email) throw badRequest('El email de confirmación no coincide');
    if (u.passwordHash && !(body.password && (await verifyPassword(body.password, u.passwordHash)))) throw unauthorized('Contraseña incorrecta', 'invalid_credentials');
    await store.transactions.deleteAllForUser(u.id);
    for (const s of await store.push.forUser(u.id)) await store.push.remove(u.id, s.endpoint);
    await store.sessions.revokeAllForUser(u.id);
    await store.users.delete(u.id);
    clearAdviceCache(u.id);
    reply.clearCookie('econ_rt', { path: '/api/auth' });
    return { ok: true };
  });

  app.delete('/me/data', auth, async (req) => {
    await store.transactions.deleteAllForUser(req.user.id);
    clearAdviceCache(req.user.id);
    return { ok: true };
  });

  // ───────── Movimientos ─────────
  app.get('/transactions', auth, async (req) => {
    const q = listQuery.parse(req.query);
    return { items: await store.transactions.list(req.user.id, q) };
  });

  app.post('/transactions', auth, async (req, reply) => {
    const input = transactionInput.parse({ ...(req.body as object), currency: req.user.currency });
    assertSaneDate(input.date, todayIn(req.user.timezone));
    const now = new Date().toISOString();
    const tx: Transaction = { ...input, currency: req.user.currency, id: randomUUID(), createdAt: now, updatedAt: now };
    await store.transactions.create(req.user.id, tx);
    return reply.status(201).send(tx);
  });

  app.patch('/transactions/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await store.transactions.get(req.user.id, id);
    if (!existing) throw notFound('Movimiento no encontrado');
    const merged = transactionInput.parse({ ...existing, ...(req.body as object), currency: req.user.currency });
    assertSaneDate(merged.date, todayIn(req.user.timezone));
    const tx: Transaction = { ...existing, ...merged, currency: req.user.currency, updatedAt: new Date().toISOString() };
    await store.transactions.update(req.user.id, tx);
    return tx;
  });

  app.delete('/transactions/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await store.transactions.delete(req.user.id, id))) throw notFound('Movimiento no encontrado');
    return reply.status(204).send();
  });

  // ───────── Analítica y consejos ─────────
  app.get('/analytics/overview', auth, async (req) => {
    const q = z.object({ month: monthStr.optional() }).parse(req.query);
    const today = todayIn(req.user.timezone);
    const txs = await store.transactions.list(req.user.id);
    return buildOverview(txs, { month: q.month ?? monthOf(today), today, currency: req.user.currency });
  });

  app.get('/advice', { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ refresh: z.enum(['1', '0']).optional() }).parse(req.query);
    const txs = await store.transactions.list(req.user.id);
    return getAdvice(cfg, {
      userId: req.user.id, plan: req.user.plan, currency: req.user.currency,
      today: todayIn(req.user.timezone), txs, refresh: q.refresh === '1',
    });
  });

  // ───────── Utilidades de desarrollo (desactivadas en producción por defecto) ─────────
  app.post('/dev/demo-data', auth, async (req) => {
    if (!cfg.allowDemoData) throw forbidden('Datos de demostración desactivados');
    const existing = await store.transactions.list(req.user.id, { limit: 1 });
    if (existing.length) throw conflict('Ya tienes movimientos. Borra tus datos antes de cargar la demo.', 'has_data');
    const demo = generateDemoTransactions(todayIn(req.user.timezone), 42);
    for (const t of demo) await store.transactions.create(req.user.id, { ...t, currency: req.user.currency });
    clearAdviceCache(req.user.id);
    return { created: demo.length };
  });

  app.post('/dev/plan', auth, async (req) => {
    if (!cfg.allowDemoData) throw forbidden('No disponible');
    const { plan } = z.object({ plan: z.enum(['free', 'premium']) }).parse(req.body);
    req.user.plan = plan;
    req.user.updatedAt = new Date().toISOString();
    await store.users.update(req.user);
    clearAdviceCache(req.user.id);
    return toPublicUser(req.user);
  });

  app.get('/config', async () => ({ googleClientId: cfg.googleClientId ?? null, demo: cfg.allowDemoData, ai: !!cfg.anthropicApiKey }));
}

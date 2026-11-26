import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CATEGORIES, categoryPrefsInput, isoDate, monthStr, registerCategories, settingsInput, transactionInput, type CustomCategory, type Transaction } from '@econsultor/shared';
import { addDays, monthOf, todayIn } from '../lib/dates.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { getAdvice, getDetailedAdvice, clearAdviceCache } from '../modules/advice/advisor.js';
import { buildOverview } from '../modules/analytics/analytics.js';
import { generateDemoTransactions } from '../modules/demo/seed.js';
import { effectivePlan } from '../lib/plan.js';
import { verifyPassword } from '../security/password.js';
import { toPublicUser } from './auth.js';
import { tk } from '../lib/i18n.js';
import { assertCategory, categoryLabelFor, fallbackCategory, newCustomId, prefsOf, unregisterAll, visibleLabels } from '../lib/categories.js';
import { syncRecurring } from '../modules/recurring/service.js';

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
  account: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export async function dataRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };

  // ───────── Perfil de cuenta ─────────
  app.get('/me', auth, async (req) => toPublicUser(req.user, cfg.premiumForAll));

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
    if (body.keepSignedIn !== undefined) u.keepSignedIn = body.keepSignedIn;
    if (body.language !== undefined) { u.language = body.language; clearAdviceCache(u.id); }
    u.updatedAt = new Date().toISOString();
    await store.users.update(u);
    return toPublicUser(u, cfg.premiumForAll);
  });

  app.get('/me/security', auth, async (req) => {
    const events = await store.audit.recent(req.user.id, 15);
    return { events: events.map((e) => ({ type: e.type, at: e.at, ip: e.ip, detail: e.detail })) };
  });

  /** Portabilidad de datos (RGPD art. 20). Nunca incluye secretos ni hashes. */
  app.get('/me/export', auth, async (req, reply) => {
    await syncRecurring(store, req.user);
    const txs = await store.transactions.list(req.user.id);
    reply.header('content-disposition', 'attachment; filename="econsultor-export.json"');
    return { exportedAt: new Date().toISOString(), user: toPublicUser(req.user, cfg.premiumForAll), recurring: req.user.recurring ?? [], transactions: txs };
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
    await store.reports.deleteForUser(u.id);
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

  // ───────── Categorías propias ─────────
  /** Sustituye la personalización de categorías: propias, nombres cambiados y ocultas. Lo que se quita pasa a «Otros». */
  app.put('/me/categories', auth, async (req) => {
    const body = categoryPrefsInput.parse(req.body);
    const u = req.user;
    const old = prefsOf(u);
    const oldById = new Map(old.custom.map((c) => [c.id, c]));
    const builtin = new Map(CATEGORIES.map((c) => [c.id, c]));

    const custom: CustomCategory[] = body.custom.map((c) => {
      const prev = c.id ? oldById.get(c.id) : undefined;
      return {
        id: prev?.id ?? newCustomId(),
        label: c.label,
        type: prev?.type ?? c.type, // el tipo de una categoría con movimientos no cambia
        family: c.family,
        fixed: c.fixed || undefined,
        discretionary: c.discretionary || undefined,
      };
    });
    const renamed: Record<string, string> = {};
    for (const [id, label] of Object.entries(body.renamed)) if (builtin.has(id)) renamed[id] = label;
    // «Otros gastos» y «Otros ingresos» siempre se pueden elegir: ahí caen los movimientos de lo que se borra.
    const hidden = [...new Set(body.hidden)].filter((id) => builtin.has(id) && id !== 'other_expense' && id !== 'other_income');

    // Un nombre no puede repetirse dentro de gastos ni de ingresos: se confundiría al elegir.
    for (const type of ['expense', 'income'] as const) {
      const seen = new Set<string>();
      for (const name of visibleLabels({ custom, renamed, hidden }, type)) {
        const key = name.trim().toLocaleLowerCase();
        if (seen.has(key)) throw badRequest('Ya hay una categoría con ese nombre', 'duplicate_category');
        seen.add(key);
      }
    }

    // Lo que ya no existe: sus movimientos y periódicos pasan a «Otros gastos / Otros ingresos».
    const removed = old.custom.filter((c) => !custom.some((n) => n.id === c.id));
    if (removed.length) {
      const gone = new Map(removed.map((c) => [c.id, c]));
      const now = new Date().toISOString();
      for (const t of await store.transactions.list(u.id)) {
        const c = gone.get(t.categoryId);
        if (c) await store.transactions.update(u.id, { ...t, categoryId: fallbackCategory(c.type), updatedAt: now });
      }
      for (const r of u.recurring ?? []) { const c = gone.get(r.categoryId); if (c) r.categoryId = fallbackCategory(c.type); }
      unregisterAll(removed.map((c) => c.id));
    }

    u.categoryPrefs = { custom, renamed, hidden };
    registerCategories(custom);
    u.updatedAt = new Date().toISOString();
    await store.users.update(u);
    clearAdviceCache(u.id);
    return toPublicUser(u, cfg.premiumForAll);
  });

  // ───────── Movimientos ─────────
  app.get('/transactions', auth, async (req) => {
    const q = listQuery.parse(req.query);
    await syncRecurring(store, req.user);
    return { items: await store.transactions.list(req.user.id, q) };
  });

  app.post('/transactions', auth, async (req, reply) => {
    const input = transactionInput.parse({ ...(req.body as object), currency: req.user.currency });
    assertSaneDate(input.date, todayIn(req.user.timezone));
    assertCategory(req.user, input.categoryId, input.type);
    const now = new Date().toISOString();
    const tx: Transaction = { ...input, account: input.account || undefined, currency: req.user.currency, id: randomUUID(), createdAt: now, updatedAt: now };
    await store.transactions.create(req.user.id, tx);
    return reply.status(201).send(tx);
  });

  app.patch('/transactions/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await store.transactions.get(req.user.id, id);
    if (!existing) throw notFound('Movimiento no encontrado');
    const merged = transactionInput.parse({ ...existing, ...(req.body as object), currency: req.user.currency });
    assertSaneDate(merged.date, todayIn(req.user.timezone));
    assertCategory(req.user, merged.categoryId, merged.type);
    const tx: Transaction = { ...existing, ...merged, account: merged.account || undefined, currency: req.user.currency, updatedAt: new Date().toISOString() };
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
    await syncRecurring(store, req.user);
    const txs = await store.transactions.list(req.user.id);
    return buildOverview(txs, { month: q.month ?? monthOf(today), today, currency: req.user.currency });
  });

  app.get('/advice', { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ refresh: z.enum(['1', '0']).optional() }).parse(req.query);
    await syncRecurring(store, req.user);
    const txs = await store.transactions.list(req.user.id);
    return getAdvice(cfg, {
      userId: req.user.id, plan: effectivePlan(cfg, req.user), currency: req.user.currency,
      today: todayIn(req.user.timezone), txs, refresh: q.refresh === '1',
    });
  });

  /** Consejos a fondo sobre tus gastos habituales. `ai=1` = la persona acepta enviar el resumen (comercios incluidos, saneados) a la IA. */
  app.get('/advice/detailed', { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ refresh: z.enum(['1', '0']).optional(), ai: z.enum(['1', '0']).optional() }).parse(req.query);
    await syncRecurring(store, req.user);
    const txs = await store.transactions.list(req.user.id);
    return getDetailedAdvice(cfg, {
      userId: req.user.id, plan: effectivePlan(cfg, req.user), currency: req.user.currency,
      today: todayIn(req.user.timezone), txs, refresh: q.refresh === '1', useAi: q.ai === '1',
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
    return toPublicUser(req.user, cfg.premiumForAll);
  });

  // ───────── Reportar un fallo o una idea ─────────
  app.post('/feedback', { ...auth, config: { rateLimit: { max: cfg.env === 'test' ? 10_000 : 6, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z
      .object({
        kind: z.enum(['bug', 'idea', 'other']).default('bug'),
        message: z.string().trim().min(5, tk('Cuéntanos un poco más (mínimo 5 letras)')).max(2000),
        page: z.string().trim().max(120).optional(),
        platform: z.string().trim().max(30).optional(),
        appVersion: z.string().trim().max(30).optional(),
      })
      .parse(req.body);
    // Tope por persona además del límite por IP: evita llenar el archivo de datos.
    if ((await store.reports.countSince(req.user.id, Date.now() - 24 * 3600_000)) >= 10) {
      throw conflict('Has enviado muchos reportes hoy. Gracias, ya los estamos revisando.', 'too_many_reports');
    }
    await store.reports.create({
      id: randomUUID(),
      userId: req.user.id,
      at: new Date().toISOString(),
      kind: b.kind,
      message: b.message,
      page: b.page,
      platform: b.platform,
      appVersion: b.appVersion,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      ip: req.ip,
    });
    return reply.status(201).send({ ok: true });
  });

  app.get('/config', async () => ({ googleClientId: cfg.googleClientId ?? null, demo: cfg.allowDemoData, ai: !!cfg.anthropicApiKey, apkUrl: cfg.apkUrl ?? null }));
}

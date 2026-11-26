import { randomUUID } from 'node:crypto';
import { isoDate, type Transaction } from '@econsultor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, todayIn } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { userHasCategory } from '@econsultor/shared';
import { prefsOf } from '../lib/categories.js';
import { clearAdviceCache } from '../modules/advice/advisor.js';
import { normAccount } from '../modules/import/accounts.js';
import { accountList, aiIdentify, analyzeStatement, MAX_ROWS } from '../modules/import/service.js';
import { importJobs, type Job } from '../modules/import/jobs.js';
import { categorize, type Categorized } from '../modules/import/categorize.js';
import { curLang } from '../lib/i18n.js';
import { notFound } from '../lib/errors.js';
import type { ImportPreview, RawRow } from '../modules/import/types.js';

const previewInput = z.object({
  kind: z.enum(['csv', 'pdf', 'sheet']),
  content: z.string().min(10),
  useAi: z.boolean().default(false),
  flipSigns: z.boolean().default(false),
  account: z.string().trim().max(40).optional(),
  assumeDifferentAccount: z.boolean().default(false),
});

const jobInput = previewInput.extend({
  /** La app genera una clave por archivo: si reintenta la subida (red caída, app dormida), no se crea una segunda tarea. */
  key: z.string().min(8).max(64),
});

/** Solo lo que hace falta para reclasificar: la descripción tal como la vio la persona y el importe. */
const classifyInput = z.object({
  key: z.string().min(8).max(64),
  items: z
    .array(z.object({ id: z.string().min(1).max(64), text: z.string().trim().min(1).max(300), amountMinor: z.number().int().min(-10_000_000_000).max(10_000_000_000) }))
    .min(1)
    .max(MAX_ROWS),
});

const jobView = (j: Job) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  progress: j.progress,
  startedAt: j.createdAt,
  ...(j.status === 'done' ? { result: j.result } : {}),
  ...(j.status === 'error' ? { error: j.error } : {}),
});

const commitInput = z.object({
  account: z.string().trim().max(40).optional(),
  rows: z
    .array(
      z.object({
        date: isoDate,
        categoryId: z.string().min(1).max(40),
        amountMinor: z.number().int().positive().max(10_000_000_000),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(MAX_ROWS),
});

/** Importación de extractos bancarios (CSV / PDF / Excel): vista previa → confirmación → alta de movimientos. */
export async function importRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };
  const limit = { max: 20, timeWindow: '1 minute' };

  app.post('/preview', { ...auth, bodyLimit: 16 * 1024 * 1024, config: { rateLimit: limit } }, async (req) => {
    const body = previewInput.parse(req.body);
    const today = todayIn(req.user.timezone);
    return analyzeStatement(cfg, store, req.user, today, { ...body, useAi: body.useAi && !!cfg.anthropicApiKey });
  });

  // Tareas en el servidor: el análisis puede tardar minutos y en el móvil una petición larga se corta al apagar la pantalla
  // o cambiar de app. Se sube el archivo una vez; la app pregunta cómo va y recoge el resultado cuando vuelva.
  app.post('/jobs', { ...auth, bodyLimit: 16 * 1024 * 1024, config: { rateLimit: limit } }, async (req, reply) => {
    const { key, ...body } = jobInput.parse(req.body);
    const today = todayIn(req.user.timezone);
    const user = req.user;
    const job = importJobs.start<ImportPreview>(user.id, 'preview', key, curLang(), (hooks) =>
      analyzeStatement(cfg, store, user, today, { ...body, useAi: body.useAi && !!cfg.anthropicApiKey }, hooks));
    return reply.code(202).send(jobView(job));
  });

  // Reclasifica con IA solo lo que sigue sin identificar, sin tocar lo que la persona ya haya cambiado a mano.
  app.post('/classify', { ...auth, bodyLimit: 2 * 1024 * 1024, config: { rateLimit: limit } }, async (req, reply) => {
    if (!cfg.anthropicApiKey) throw badRequest('La IA no está disponible en este servidor.', 'ai_unavailable');
    const { key, items } = classifyInput.parse(req.body);
    const today = todayIn(req.user.timezone);
    const userId = req.user.id;
    const job = importJobs.start(userId, 'classify', key, curLang(), async (hooks) => {
      const raw: RawRow[] = items.map((it) => ({ date: today, amountMinor: it.amountMinor, name: it.text }));
      // Se parte de «sin clasificar» para que la IA pregunte por todas, pero primero se pasan las reglas por si alguna ya la reconocen.
      const cats: Categorized[] = raw.map((r) => ({ ...categorize(r, new Map()), confidence: 'low' as const }));
      const ai = await aiIdentify(cfg, userId, today, raw, cats, hooks);
      return {
        ai: ai.info,
        warnings: ai.warnings,
        results: items.flatMap((it, i) => (cats[i]!.via === 'ai' ? [{ id: it.id, categoryId: cats[i]!.categoryId, hint: cats[i]!.hint ?? '', web: !!cats[i]!.web }] : [])),
      };
    });
    return reply.code(202).send(jobView(job));
  });

  app.get('/jobs/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(8).max(64) }).parse(req.params);
    const job = importJobs.get(req.user.id, id);
    if (!job) throw notFound('Este análisis ya no está disponible. Vuelve a subir el archivo.');
    return jobView(job);
  });

  app.delete('/jobs/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(8).max(64) }).parse(req.params);
    importJobs.remove(req.user.id, id);
    return reply.code(204).send();
  });

  app.get('/accounts', auth, async (req) => ({ accounts: accountList(await store.transactions.list(req.user.id, { limit: 50_000 })) }));

  app.post('/commit', { ...auth, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: limit } }, async (req) => {
    const { rows, account } = commitInput.parse(req.body);
    const today = todayIn(req.user.timezone);
    const maxDate = addDays(today, 1);
    if (rows.some((r) => r.date < '2000-01-01' || r.date > maxDate)) throw badRequest('Hay fechas fuera de rango');

    // Cada fila debe llevar una categoría que exista para esta cuenta (de serie o propia).
    const prefs = prefsOf(req.user);
    if (rows.some((r) => !userHasCategory(prefs, r.categoryId))) throw badRequest('Esa categoría no existe', 'unknown_category');

    const now = new Date().toISOString();
    for (const r of rows) {
      const t: Transaction = {
        id: randomUUID(),
        type: userHasCategory(prefs, r.categoryId)!.type,
        amountMinor: r.amountMinor,
        currency: req.user.currency,
        categoryId: r.categoryId,
        date: r.date,
        note: r.note || undefined,
        account: normAccount(account) || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await store.transactions.create(req.user.id, t);
    }

    // El perfil financiero no se guarda aparte: se deriva de los movimientos. Invalidar la caché hace que
    // el próximo consejo se calcule ya con los datos importados.
    clearAdviceCache(req.user.id);
    const dates = rows.map((r) => r.date).sort();
    const months = new Set(dates.map((d) => d.slice(0, 7)));
    await store.audit.append({ id: randomUUID(), userId: req.user.id, type: 'statement_import', at: now, ip: req.ip, detail: `${rows.length} movimientos` });
    return { created: rows.length, from: dates[0]!, to: dates[dates.length - 1]!, monthsCovered: months.size };
  });
}

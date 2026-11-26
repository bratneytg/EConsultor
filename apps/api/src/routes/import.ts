import { randomUUID } from 'node:crypto';
import { CATEGORY_IDS, categoryById, isoDate, type Transaction } from '@econsultor/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDays, todayIn } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { clearAdviceCache } from '../modules/advice/advisor.js';
import { normAccount } from '../modules/import/accounts.js';
import { accountList, analyzeStatement, MAX_ROWS } from '../modules/import/service.js';

const previewInput = z.object({
  kind: z.enum(['csv', 'pdf', 'sheet']),
  content: z.string().min(10),
  useAi: z.boolean().default(false),
  flipSigns: z.boolean().default(false),
  account: z.string().trim().max(40).optional(),
  assumeDifferentAccount: z.boolean().default(false),
});

const commitInput = z.object({
  account: z.string().trim().max(40).optional(),
  rows: z
    .array(
      z.object({
        date: isoDate,
        categoryId: z.enum(CATEGORY_IDS),
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

  app.get('/accounts', auth, async (req) => ({ accounts: accountList(await store.transactions.list(req.user.id, { limit: 50_000 })) }));

  app.post('/commit', { ...auth, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: limit } }, async (req) => {
    const { rows, account } = commitInput.parse(req.body);
    const today = todayIn(req.user.timezone);
    const maxDate = addDays(today, 1);
    if (rows.some((r) => r.date < '2000-01-01' || r.date > maxDate)) throw badRequest('Hay fechas fuera de rango');

    const now = new Date().toISOString();
    for (const r of rows) {
      const t: Transaction = {
        id: randomUUID(),
        type: categoryById(r.categoryId)!.type,
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

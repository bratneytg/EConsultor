import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { monthStr } from '@econsultor/shared';
import { categoryLabelFor, prefsOf } from '../lib/categories.js';
import { curLang, localeOf } from '../lib/i18n.js';
import { monthOf, todayIn } from '../lib/dates.js';
import { buildOverview } from '../modules/analytics/analytics.js';
import { buildNarrative } from '../modules/report/narrative.js';
import { renderMonthlyReport } from '../modules/report/pdf.js';
import { syncRecurring } from '../modules/recurring/service.js';

/** Informe mensual en PDF: resumen escrito del mes y los datos de gastos. */
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const { store } = app;

  app.get('/monthly', { preHandler: app.requireAuth, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = z.object({ month: monthStr.optional() }).parse(req.query);
    const user = req.user;
    const today = todayIn(user.timezone);
    const month = q.month ?? monthOf(today);
    await syncRecurring(store, user);
    const txs = await store.transactions.list(user.id);
    const overview = buildOverview(txs, { month, today, currency: user.currency });
    const monthTxs = txs.filter((t) => monthOf(t.date) === month);

    const prefs = prefsOf(user);
    const label = (id: string) => categoryLabelFor(prefs, id);
    const recurring = (user.recurring ?? []).filter((r) => r.active);
    const recurringMonthly = recurring.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amountMinor, 0);
    const money = (minor: number): string =>
      (minor / 100).toLocaleString(localeOf(curLang()), { style: 'currency', currency: user.currency, maximumFractionDigits: 0 });

    const narrative = buildNarrative(overview, monthTxs, { money, label, recurringMonthlyMinor: recurringMonthly, hasRecurring: recurring.length > 0 });
    const pdf = await renderMonthlyReport({
      overview, monthTxs, narrative, label, userName: user.displayName,
      recurring: recurring.map((r) => ({ name: r.name, day: r.day, categoryId: r.categoryId, amountMinor: r.amountMinor, type: r.type })),
      generatedOn: new Date().toLocaleDateString(localeOf(curLang()), { dateStyle: 'long', timeZone: user.timezone }),
    });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="econsultor-${month}.pdf"`)
      .send(Buffer.from(pdf));
  });
}

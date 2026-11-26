import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_RECURRING, recurringInput, type Recurring } from '@econsultor/shared';
import { clearAdviceCache } from '../modules/advice/advisor.js';
import { assertCategory } from '../lib/categories.js';
import { monthOf, shiftMonth, todayIn } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { chargeDate, defaultStartMonth, nextCharge, syncRecurring } from '../modules/recurring/service.js';

const idParam = z.object({ id: z.string().uuid() });

/** Gastos e ingresos que se repiten cada mes: alquiler, transporte, suscripciones, nómina… */
export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  const { store } = app;
  const auth = { preHandler: app.requireAuth };
  const view = (r: Recurring): Recurring => ({ ...r, nextDate: r.active ? nextCharge(r) : undefined });

  app.get('/', auth, async (req) => {
    await syncRecurring(store, req.user);
    const items = [...(req.user.recurring ?? [])].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
    return { items: items.map(view) };
  });

  app.post('/', auth, async (req, reply) => {
    const input = recurringInput.parse(req.body);
    assertCategory(req.user, input.categoryId, input.type);
    const list = (req.user.recurring ??= []);
    if (list.length >= MAX_RECURRING) throw conflict('Has llegado al máximo de gastos periódicos', 'too_many_recurring');
    const today = todayIn(req.user.timezone);
    const startMonth = input.startMonth ?? defaultStartMonth(input.day, today);
    // Un primer mes muy lejano en el futuro no tiene sentido y un error de tecleo llenaría la lista.
    if (startMonth > shiftMonth(monthOf(today), 12)) throw badRequest('El primer mes está demasiado lejos');
    const r: Recurring = {
      id: randomUUID(),
      type: input.type,
      amountMinor: input.amountMinor,
      categoryId: input.categoryId,
      name: input.name,
      day: input.day,
      startMonth,
      endMonth: input.endMonth ?? undefined,
      account: input.account || undefined,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    };
    list.push(r);
    req.user.updatedAt = r.createdAt;
    await store.users.update(req.user);
    await syncRecurring(store, req.user);
    clearAdviceCache(req.user.id);
    return reply.status(201).send(view(r));
  });

  app.patch('/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const r = req.user.recurring?.find((x) => x.id === id);
    if (!r) throw notFound('Gasto periódico no encontrado');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merged = recurringInput.parse({
      type: r.type, amountMinor: r.amountMinor, categoryId: r.categoryId, name: r.name, day: r.day,
      startMonth: r.startMonth, endMonth: r.endMonth ?? null, account: r.account, active: r.active, ...body,
    });
    assertCategory(req.user, merged.categoryId, merged.type);
    const today = todayIn(req.user.timezone);
    const wasActive = r.active;
    Object.assign(r, {
      type: merged.type, amountMinor: merged.amountMinor, categoryId: merged.categoryId, name: merged.name, day: merged.day,
      endMonth: merged.endMonth ?? undefined, account: merged.account || undefined, active: merged.active ?? r.active,
    });
    // Cambiar el primer mes solo vale mientras no se haya anotado nada: después no se reescribe el pasado.
    if (merged.startMonth && !r.lastGenerated) r.startMonth = merged.startMonth;
    // Al reanudar uno en pausa no se anotan de golpe los meses que estuvo parado.
    if (!wasActive && r.active) {
      const thisMonth = monthOf(today);
      const skipTo = chargeDate(thisMonth, r.day) <= today ? thisMonth : shiftMonth(thisMonth, -1);
      if (!r.lastGenerated || r.lastGenerated < skipTo) r.lastGenerated = skipTo;
    }
    req.user.updatedAt = new Date().toISOString();
    await store.users.update(req.user);
    await syncRecurring(store, req.user);
    clearAdviceCache(req.user.id);
    return view(r);
  });

  /** Se borra la regla; los movimientos que ya generó se quedan (son historia). */
  app.delete('/:id', auth, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const list = req.user.recurring ?? [];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw notFound('Gasto periódico no encontrado');
    list.splice(i, 1);
    req.user.updatedAt = new Date().toISOString();
    await store.users.update(req.user);
    return reply.status(204).send();
  });
}

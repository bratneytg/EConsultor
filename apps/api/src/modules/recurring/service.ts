import { randomUUID } from 'node:crypto';
import type { Recurring, Transaction } from '@econsultor/shared';
import { daysInMonth, monthOf, shiftMonth, todayIn } from '../../lib/dates.js';
import type { Store, UserRecord } from '../../store/types.js';

/** Los gastos periódicos no rellenan más de tres años hacia atrás. */
const MAX_BACKFILL_MONTHS = 36;

/** Fecha del cargo en un mes: el día elegido o, si el mes es más corto, el último día. */
export const chargeDate = (month: string, day: number): string =>
  `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;

/** Primer mes que aún no se ha anotado. */
function pendingMonth(r: Recurring): string {
  return r.lastGenerated ? shiftMonth(r.lastGenerated, 1) : r.startMonth;
}

/** Siguiente cargo previsto (para enseñarlo en la lista). */
export function nextCharge(r: Recurring): string | undefined {
  const m = pendingMonth(r);
  if (r.endMonth && m > r.endMonth) return undefined;
  return chargeDate(m, r.day);
}

/** Primer mes por defecto: este mes si el día aún no ha llegado; si ya pasó, el próximo. */
export function defaultStartMonth(day: number, today: string): string {
  const month = monthOf(today);
  return chargeDate(month, day) > today ? month : shiftMonth(month, 1);
}

/** Un solo proceso a la vez por persona: dos peticiones simultáneas no pueden duplicar el cargo del mes. */
const locks = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  return run;
}

/**
 * Anota los cargos periódicos que ya tocan (hasta hoy). Es idempotente: cada gasto recuerda el último mes anotado,
 * así que un movimiento borrado a mano no vuelve a aparecer. Devuelve cuántos movimientos ha creado.
 */
export function syncRecurring(store: Store, user: UserRecord, now = new Date()): Promise<number> {
  const list = user.recurring;
  if (!list?.length) return Promise.resolve(0);
  return serial(user.id, async () => {
    const today = todayIn(user.timezone, now);
    const earliest = shiftMonth(monthOf(today), -MAX_BACKFILL_MONTHS);
    let created = 0;
    let changed = false;
    for (const r of list) {
      if (!r.active) continue;
      let m = pendingMonth(r);
      if (m < earliest) m = earliest;
      while (m <= monthOf(today) && (!r.endMonth || m <= r.endMonth)) {
        const date = chargeDate(m, r.day);
        if (date > today) break;
        const stamp = new Date().toISOString();
        const tx: Transaction = {
          id: randomUUID(),
          type: r.type,
          amountMinor: r.amountMinor,
          currency: user.currency,
          categoryId: r.categoryId,
          note: r.name,
          date,
          account: r.account || undefined,
          recurringId: r.id,
          createdAt: stamp,
          updatedAt: stamp,
        };
        await store.transactions.create(user.id, tx);
        r.lastGenerated = m;
        created++;
        changed = true;
        m = shiftMonth(m, 1);
      }
    }
    if (changed) {
      user.updatedAt = new Date().toISOString();
      await store.users.update(user);
    }
    return created;
  });
}

/** Revisa a todas las personas cada hora (y al arrancar): así los cargos aparecen aunque no abran la app ese día. */
export function startRecurringScheduler(store: Store, log: { info: (m: string) => void; error: (e: unknown) => void }): () => void {
  const run = async () => {
    for (const u of await store.users.all()) await syncRecurring(store, u);
  };
  run().catch((e) => log.error(e));
  const timer = setInterval(() => run().catch((e) => log.error(e)), 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}

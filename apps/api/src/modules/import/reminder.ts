import type { StatementReminderInfo } from '@econsultor/shared';
import { monthOf, shiftMonth, todayIn } from '../../lib/dates.js';
import type { Store, UserRecord } from '../../store/types.js';

export const DEFAULT_DAY = 3;

/** Última vez que la persona confirmó una importación: lo guardado, o (cuentas anteriores a este aviso) el registro de actividad. */
export async function lastImportAt(store: Store, user: UserRecord): Promise<string | undefined> {
  const saved = user.statementReminder?.lastImportAt;
  if (saved) return saved;
  const ev = (await store.audit.recent(user.id, 300)).filter((e) => e.type === 'statement_import').map((e) => e.at).sort().pop();
  return ev;
}

/**
 * Toca avisar si la persona ya ha subido extractos alguna vez (quien nunca lo ha hecho no necesita el recordatorio),
 * ya llegó el día elegido, este mes aún no ha subido ninguno y no ha descartado el aviso de este mes.
 */
export async function reminderInfo(store: Store, user: UserRecord, now = new Date()): Promise<StatementReminderInfo> {
  const r = user.statementReminder ?? {};
  const today = todayIn(user.timezone, now);
  const month = monthOf(today);
  const last = await lastImportAt(store, user);
  const day = r.day ?? DEFAULT_DAY;
  const enabled = r.enabled ?? true;
  const due = enabled && !!last && Number(today.slice(8, 10)) >= day && monthOf(last.slice(0, 10)) < month && r.dismissedMonth !== month;
  return { enabled, day, due, month, statementMonth: shiftMonth(month, -1), ...(last ? { lastImportAt: last } : {}) };
}

export async function markImported(store: Store, user: UserRecord, now = new Date()): Promise<void> {
  user.statementReminder = { ...user.statementReminder, lastImportAt: now.toISOString() };
  user.updatedAt = now.toISOString();
  await store.users.update(user);
}

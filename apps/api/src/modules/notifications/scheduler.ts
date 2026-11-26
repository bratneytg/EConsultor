import webpush from 'web-push';
import type { Config } from '../../config.js';
import { streakDays } from '../analytics/analytics.js';
import { todayIn, timeIn } from '../../lib/dates.js';
import type { Store } from '../../store/types.js';
import { localeOf, runWithLang, tr } from '../../lib/i18n.js';
import type { Lang } from '@econsultor/shared';
import { reminderInfo } from '../import/reminder.js';

export interface PushSender {
  (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<void>;
}

const defaultSender: PushSender = async (sub, payload) => {
  await webpush.sendNotification(sub, payload);
};

function reminderText(name: string, streak: number): { title: string; body: string } {
  const first = name.split(' ')[0] ?? name;
  if (streak >= 3) return { title: tr('🔥 Racha de {n} días', { n: streak }), body: tr('{name}, apunta los movimientos de hoy y no la rompas. Solo te llevará 30 segundos.', { name: first }) };
  return { title: tr('¿Cómo ha ido el día?'), body: tr('{name}, anota tus gastos e ingresos de hoy para mantener tus gráficas al día.', { name: first }) };
}

/**
 * Recordatorio diario: a la hora elegida por el usuario (en SU zona horaria), si aún no ha
 * registrado nada hoy y no se le ha avisado ya hoy. Función pura respecto a `now` → testable.
 * Devuelve cuántos avisos se enviaron.
 */
export async function runReminders(store: Store, now = new Date(), send: PushSender = defaultSender): Promise<number> {
  let sent = 0;
  for (const user of await store.users.all()) {
    if (!user.reminderEnabled) continue;
    const today = todayIn(user.timezone, now);
    if (user.lastReminderDate === today) continue;
    if (timeIn(user.timezone, now) < user.reminderTime) continue;

    const subs = await store.push.forUser(user.id);
    if (!subs.length) continue;

    const txs = await store.transactions.list(user.id, { from: todayIn(user.timezone, new Date(now.getTime() - 40 * 86_400_000)) });
    if (txs.some((t) => t.date === today)) {
      user.lastReminderDate = today; // ya ha registrado: nada que recordar
      await store.users.update(user);
      continue;
    }

    const payload = JSON.stringify({ ...runWithLang(user.language ?? 'en', () => reminderText(user.displayName, streakDays(txs, today))), url: '/?add=1' });
    let delivered = false;
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: s.keys }, payload);
        delivered = true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await store.push.remove(user.id, s.endpoint); // suscripción caducada
      }
    }
    if (delivered) {
      sent++;
      user.lastReminderDate = today;
      await store.users.update(user);
    }
  }
  return sent;
}

const monthLabelFor = (lang: Lang, month: string): string => new Intl.DateTimeFormat(localeOf(lang), { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

/** Hora local a partir de la cual se manda el aviso mensual del extracto (por la mañana, no de madrugada). */
const STATEMENT_HOUR = '10:00';

/**
 * Aviso mensual: «es hora de subir el extracto». Una vez al mes como mucho, a las 10:00 locales, a quien ya ha importado
 * extractos antes y aún no ha subido el de este mes. Devuelve cuántos avisos se enviaron.
 */
export async function runStatementReminders(store: Store, now = new Date(), send: PushSender = defaultSender): Promise<number> {
  let sent = 0;
  for (const user of await store.users.all()) {
    if (timeIn(user.timezone, now) < STATEMENT_HOUR) continue;
    if (user.statementReminder?.pushedMonth === todayIn(user.timezone, now).slice(0, 7)) continue;
    const info = await reminderInfo(store, user, now);
    if (!info.due) continue;
    const subs = await store.push.forUser(user.id);
    if (!subs.length) continue;
    const first = user.displayName.split(' ')[0] ?? user.displayName;
    const payload = JSON.stringify({
      ...runWithLang(user.language ?? 'en', () => ({
        title: tr('Es hora de subir tu extracto'),
        body: tr('{name}, sube el extracto de {month} y tus gráficas quedarán completas. Si ya capturas pagos desde el móvil, no se duplicarán.', { name: first, month: monthLabelFor(user.language ?? 'en', info.statementMonth) }),
      })),
      url: '/movimientos?import=1',
    });
    let delivered = false;
    for (const s of subs) {
      try { await send({ endpoint: s.endpoint, keys: s.keys }, payload); delivered = true; }
      catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await store.push.remove(user.id, s.endpoint);
      }
    }
    if (delivered) {
      sent++;
      user.statementReminder = { ...user.statementReminder, pushedMonth: info.month };
      await store.users.update(user);
    }
  }
  return sent;
}

export function startReminderScheduler(cfg: Config, store: Store, log: { info: (m: string) => void; error: (e: unknown) => void }): () => void {
  if (!cfg.vapid) {
    log.info('Recordatorios push desactivados (faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
    return () => {};
  }
  webpush.setVapidDetails(cfg.vapid.subject, cfg.vapid.publicKey, cfg.vapid.privateKey);
  const timer = setInterval(() => {
    runReminders(store).catch((e) => log.error(e));
    runStatementReminders(store).catch((e) => log.error(e));
  }, 60_000);
  timer.unref();
  log.info('Planificador de recordatorios diarios activo');
  return () => clearInterval(timer);
}

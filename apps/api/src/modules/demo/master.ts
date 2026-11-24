import { randomUUID } from 'node:crypto';
import type { Config } from '../../config.js';
import { todayIn } from '../../lib/dates.js';
import { hashPassword, verifyPassword } from '../../security/password.js';
import type { Store, UserRecord } from '../../store/types.js';
import { clearAdviceCache } from '../advice/advisor.js';
import { generateDemoTransactions } from './seed.js';

/** Cuenta maestra de pruebas: usuario «admin», contraseña «admin». Sin privilegios especiales. */
export const MASTER_LOGIN = 'admin';
const MASTER_PASSWORD = 'admin';
const MASTER_TZ = 'Europe/Berlin';

/**
 * Garantiza que existe la cuenta maestra con datos de demostración.
 *
 * Solo existe mientras `ALLOW_DEMO_DATA` esté activo (por defecto: desarrollo). Con ese interruptor
 * apagado —el valor de producción— la cuenta no se crea y las credenciales `admin/admin` no sirven.
 * En cada arranque se restablecen la contraseña, el bloqueo y el 2FA para que las credenciales
 * documentadas funcionen siempre, y se vuelven a cargar los datos si la cuenta está vacía.
 */
export async function ensureMasterUser(cfg: Config, store: Store): Promise<{ created: boolean; seeded: number } | null> {
  if (!cfg.allowDemoData) return null;

  const now = new Date().toISOString();
  let user = await store.users.byEmail(MASTER_LOGIN);
  const created = !user;

  if (!user) {
    const fresh: UserRecord = {
      id: randomUUID(),
      email: MASTER_LOGIN,
      displayName: 'Admin',
      passwordHash: await hashPassword(MASTER_PASSWORD),
      plan: 'premium',
      currency: 'EUR',
      timezone: MASTER_TZ,
      reminderEnabled: false,
      reminderTime: '21:00',
      uiMode: 'simple',
      mfa: { enabled: false, recoveryHashes: [] },
      failedLogins: 0,
      createdAt: now,
      updatedAt: now,
    };
    await store.users.create(fresh);
    user = fresh;
  } else {
    const passwordOk = !!user.passwordHash && (await verifyPassword(MASTER_PASSWORD, user.passwordHash));
    user.passwordHash = passwordOk ? user.passwordHash : await hashPassword(MASTER_PASSWORD);
    user.mfa = { enabled: false, recoveryHashes: [] };
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    user.updatedAt = now;
    await store.users.update(user);
  }

  let seeded = 0;
  const existing = await store.transactions.list(user.id, { limit: 1 });
  if (existing.length === 0) {
    const demo = generateDemoTransactions(todayIn(user.timezone), 42);
    for (const t of demo) await store.transactions.create(user.id, { ...t, currency: user.currency });
    clearAdviceCache(user.id);
    seeded = demo.length;
  }
  return { created, seeded };
}

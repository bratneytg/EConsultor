import type { Config } from '../config.js';
import type { SessionRecord, Store, UserRecord } from '../store/types.js';

/** No se reescribe el registro de la sesión más de una vez cada tantos segundos. */
const TOUCH_EVERY_MS = 20_000;

export const idleLimitMs = (cfg: Config): number => cfg.idleTimeoutMin * 60_000;

/** ¿Lleva la sesión más tiempo del permitido sin actividad real? Con `keepSignedIn` o límite 0 nunca caduca. */
export function idleExpired(cfg: Config, user: Pick<UserRecord, 'keepSignedIn'>, s: SessionRecord, now = Date.now()): boolean {
  if (user.keepSignedIn || cfg.idleTimeoutMin <= 0) return false;
  const last = s.lastActiveAt ?? Date.parse(s.createdAt);
  return now - last > idleLimitMs(cfg);
}

export async function noteActivity(store: Store, s: SessionRecord, now = Date.now()): Promise<void> {
  if (s.lastActiveAt && now - s.lastActiveAt < TOUCH_EVERY_MS) return;
  s.lastActiveAt = now;
  await store.sessions.update(s);
}

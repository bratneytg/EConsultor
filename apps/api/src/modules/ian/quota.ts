/**
 * Tope diario de mensajes a Ian por cuenta: controla el coste de la IA y frena abusos.
 * Se lleva en memoria: si el servidor se reinicia, el contador de ese día vuelve a empezar (basta para acotar el gasto).
 */
const used = new Map<string, { day: string; n: number }>();

export function remaining(userId: string, day: string, limit: number): number {
  const u = used.get(userId);
  return Math.max(0, limit - (u && u.day === day ? u.n : 0));
}

/** Gasta un mensaje. Devuelve false si ya no quedan. */
export function take(userId: string, day: string, limit: number): boolean {
  if (remaining(userId, day, limit) <= 0) return false;
  const u = used.get(userId);
  used.set(userId, { day, n: (u && u.day === day ? u.n : 0) + 1 });
  return true;
}

/** Devuelve un mensaje cuando la IA no ha llegado a responder (no es culpa de la persona). */
export function give(userId: string, day: string): void {
  const u = used.get(userId);
  if (u && u.day === day && u.n > 0) u.n -= 1;
}

export const _reset = (): void => used.clear();

/**
 * Cupo diario de comercios que la IA puede buscar en internet, por cuenta: cada búsqueda cuesta dinero y sin tope
 * un extracto enorme (o un abuso) lo dispararía. En memoria: si el servidor se reinicia, el día vuelve a empezar.
 */
const used = new Map<string, { day: string; n: number }>();

export function lookupsLeft(userId: string, day: string, limit: number): number {
  const u = used.get(userId);
  return Math.max(0, limit - (u && u.day === day ? u.n : 0));
}

/** Concede hasta `wanted` búsquedas y las descuenta. Devuelve cuántas ha concedido. */
export function grantLookups(userId: string, day: string, limit: number, wanted: number): number {
  const n = Math.min(wanted, lookupsLeft(userId, day, limit));
  if (n > 0) {
    const u = used.get(userId);
    used.set(userId, { day, n: (u && u.day === day ? u.n : 0) + n });
  }
  return n;
}

/** Devuelve las búsquedas que no se llegaron a hacer (falló la IA: no es culpa de la persona). */
export function refundLookups(userId: string, day: string, n: number): void {
  const u = used.get(userId);
  if (u && u.day === day && n > 0) u.n = Math.max(0, u.n - n);
}

export const _resetLookups = (): void => used.clear();

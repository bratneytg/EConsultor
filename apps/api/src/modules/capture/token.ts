import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token personal de captura. Va en el móvil (Atajo de iPhone o app de Android) y solo sirve para añadir pagos
 * PENDIENTES a su dueño: no lee movimientos ni cambia nada más. Se guarda solo su hash; el token se enseña una vez.
 */
export const TOKEN_PREFIX = 'ecp_';

export function newToken(): { token: string; hash: string; hint: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Comparación en tiempo constante entre el hash guardado y el del token recibido. */
export function tokenMatches(storedHash: string | undefined, token: string): boolean {
  if (!storedHash || !token.startsWith(TOKEN_PREFIX) || token.length > 80) return false;
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

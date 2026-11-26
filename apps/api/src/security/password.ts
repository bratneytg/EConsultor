import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { tk } from '../lib/i18n.js';

/**
 * scrypt (OWASP: N=2^16, r=8, p=2 ≈ 64 MB). Sin dependencias nativas.
 * Formato autodescriptivo para poder subir parámetros sin romper hashes antiguos:
 *   scrypt$N$r$p$<salt>$<hash>
 */
const N = 2 ** 16;
const R = 8;
const P = 2;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash ficticio para igualar tiempos cuando el usuario no existe (anti-enumeración). */
let dummy: Promise<string> | undefined;
export function dummyVerify(password: string): Promise<boolean> {
  dummy ??= hashPassword('dummy-password-for-timing');
  return dummy.then((h) => verifyPassword(password, h)).then(() => false);
}

const COMMON = new Set([
  'password12', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'contraseña', 'contrasena1',
  'iloveyou12', 'abcdefghij', 'econsultor',
]);

/** Política: longitud ≥10 (en el esquema), sin contraseñas comunes ni derivadas del email. */
export function passwordProblem(password: string, email: string): string | null {
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return tk('Esa contraseña es demasiado común');
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return tk('La contraseña no debe contener tu email');
  if (/^(.)\1+$/.test(password)) return tk('La contraseña es demasiado repetitiva');
  return null;
}

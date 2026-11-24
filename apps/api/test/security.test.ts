import { describe, expect, it } from 'vitest';
import { open, seal } from '../src/security/crypto.js';
import { hashPassword, passwordProblem, verifyPassword } from '../src/security/password.js';
import { base32Decode, base32Encode, generateRecoveryCodes, hotp, totpAt, verifyTotp } from '../src/security/totp.js';
import { randomBytes } from 'node:crypto';

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('coincide con los vectores de prueba oficiales', () => {
    // RFC 4226 Apéndice D: contadores 0..2
    const key = Buffer.from('12345678901234567890');
    expect(hotp(key, 0)).toBe('755224');
    expect(hotp(key, 1)).toBe('287082');
    expect(hotp(key, 2)).toBe('359152');
    // RFC 6238: T=59s → 94287082 (8 dígitos) → 287082 en 6 dígitos
    expect(totpAt(secret, 59_000)).toBe('287082');
  });

  it('base32 es reversible', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('acepta ±1 paso y rechaza la reutilización (anti-replay)', () => {
    const t = 1_700_000_000_000;
    const code = totpAt(secret, t);
    const step = verifyTotp(secret, code, t);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, t + 30_000)).not.toBeNull(); // un paso después sigue valiendo
    expect(verifyTotp(secret, code, t, step!)).toBeNull(); // pero no se puede reutilizar
    expect(verifyTotp(secret, code, t + 120_000)).toBeNull(); // fuera de ventana
    expect(verifyTotp(secret, '12345', t)).toBeNull();
  });

  it('genera códigos de recuperación únicos', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  });
});

describe('contraseñas', () => {
  it('hashea con scrypt y verifica', async () => {
    const h = await hashPassword('correcta-caballo-bateria');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correcta-caballo-bateria', h)).toBe(true);
    expect(await verifyPassword('otra-cosa-distinta', h)).toBe(false);
    expect(await hashPassword('correcta-caballo-bateria')).not.toBe(h); // sal aleatoria
  });

  it('rechaza contraseñas débiles', () => {
    expect(passwordProblem('password123', 'a@b.com')).toBeTruthy();
    expect(passwordProblem('maria.lopez.2024', 'maria.lopez@x.com')).toBeTruthy();
    expect(passwordProblem('aaaaaaaaaaaa', 'a@b.com')).toBeTruthy();
    expect(passwordProblem('Xk9-mango-lluvia-77', 'a@b.com')).toBeNull();
  });
});

describe('cifrado AES-256-GCM', () => {
  const key = randomBytes(32);
  it('ida y vuelta, y detecta manipulación', () => {
    const sealed = seal(key, 'secreto totp');
    expect(open(key, sealed).toString()).toBe('secreto totp');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('manipulado').toString('base64url');
    expect(() => open(key, parts.join('.'))).toThrow();
    expect(() => open(randomBytes(32), sealed)).toThrow();
  });
});

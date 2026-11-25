import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileStore } from '../src/store/file-store.js';
import type { UserRecord } from '../src/store/types.js';

const dir = mkdtempSync(join(tmpdir(), 'econ-informe-'));
const file = join(dir, 'store.json');
const key = randomBytes(32);

const user = (id: string, email: string, extra: Partial<UserRecord> = {}): UserRecord => ({
  id,
  email,
  displayName: id,
  plan: 'free',
  currency: 'EUR',
  timezone: 'Europe/Berlin',
  reminderEnabled: true,
  reminderTime: '21:00',
  mfa: { enabled: false, recoveryHashes: [] },
  failedLogins: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra,
});

function informe(args: string[], clave = key) {
  return spawnSync('npx', ['tsx', 'src/informe.ts', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATA_FILE: file, DATA_ENCRYPTION_KEY: clave.toString('base64') },
  });
}

beforeAll(async () => {
  const s = new FileStore({ file, encryptionKey: key });
  await s.users.create(user('u1', 'maria.lopez@example.com'));
  await s.users.create(user('u2', 'pedro@example.com', { plan: 'premium' }));
  const now = new Date().toISOString();
  await s.transactions.create('u1', {
    id: 't1',
    date: '2026-11-10',
    type: 'expense',
    categoryId: 'food',
    amountMinor: 987654,
    note: 'NOTA-PRIVADA',
    createdAt: now,
    updatedAt: now,
  } as never);
  await s.audit.append({ id: 'a1', userId: 'u1', type: 'register', at: now, ip: '203.0.113.7' });
  for (let i = 0; i < 5; i++) await s.audit.append({ id: `f${i}`, type: 'login_failed', at: now, ip: '198.51.100.9', detail: 'unknown' });
  await s.flush();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('informes de administración (solo lectura)', () => {
  it('«base» cuenta usuarios y movimientos sin mostrar datos privados', () => {
    const r = informe(['base']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Cuentas en total: 2 (1 gratuita, 1 de pago)');
    expect(r.stdout).toContain('Total guardados: 1');
    expect(r.stdout).toContain('[OK] Está cifrado');
    expect(r.stdout).not.toContain('NOTA-PRIVADA');
    expect(r.stdout).not.toContain('987654');
    expect(r.stdout).not.toContain('maria.lopez');
  });

  it('«actividad» enmascara correos y avisa de intentos fallidos repetidos', () => {
    const r = informe(['actividad', '7']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ma***@example.com');
    expect(r.stdout).not.toContain('maria.lopez');
    expect(r.stdout).toContain('5 intentos fallidos desde la dirección 198.51.100.9');
    expect(r.stdout).not.toContain('NOTA-PRIVADA');
  });

  it('con una clave equivocada falla sin tocar el archivo', () => {
    const r = informe(['base'], randomBytes(32));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('la clave no coincide');
  });

  it('no escribe nada en el archivo de datos', () => {
    const antes = execFileSync('cat', [file], { encoding: 'utf8' });
    informe(['base']);
    informe(['actividad', '30']);
    expect(execFileSync('cat', [file], { encoding: 'utf8' })).toBe(antes);
  });
});

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { reminderInfo } from '../src/modules/import/reminder.js';
import { runStatementReminders } from '../src/modules/notifications/scheduler.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';
import type { UserRecord } from '../src/store/types.js';

const user = (over: Partial<UserRecord> = {}): UserRecord => ({
  id: 'u1', email: 'a@b.com', displayName: 'Ana García', plan: 'free', currency: 'EUR', timezone: 'Europe/Berlin', language: 'es',
  reminderEnabled: false, reminderTime: '21:00', mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: '', updatedAt: '', ...over,
});
async function setup(over: Partial<UserRecord> = {}, imported?: string) {
  const store = new FileStore({ file: null });
  await store.users.create(user(over));
  await store.push.upsert({ endpoint: 'https://push.example/1', userId: 'u1', keys: { p256dh: 'x', auth: 'y' }, createdAt: '' });
  if (imported) await store.audit.append({ id: 'e1', userId: 'u1', type: 'statement_import', at: imported, ip: '', detail: '' });
  return store;
}
const NOV = (d: number, h = 12) => new Date(`2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`);

describe('recordatorio mensual del extracto', () => {
  it('solo avisa a quien ya ha importado alguna vez, desde el día elegido y si este mes no ha subido nada', async () => {
    const never = await setup();
    expect((await reminderInfo(never, (await never.users.byId('u1'))!, NOV(10))).due).toBe(false);

    const store = await setup({}, '2026-10-05T10:00:00Z');
    const u = (await store.users.byId('u1'))!;
    expect((await reminderInfo(store, u, NOV(2))).due).toBe(false); // aún no es el día 3
    const info = await reminderInfo(store, u, NOV(3));
    expect(info).toMatchObject({ due: true, enabled: true, day: 3, month: '2026-11', statementMonth: '2026-10' });

    u.statementReminder = { lastImportAt: '2026-11-04T10:00:00Z' }; // ya subió este mes
    expect((await reminderInfo(store, u, NOV(10))).due).toBe(false);
    u.statementReminder = { enabled: false, lastImportAt: '2026-10-05T10:00:00Z' };
    expect((await reminderInfo(store, u, NOV(10))).due).toBe(false);
    u.statementReminder = { day: 15, lastImportAt: '2026-10-05T10:00:00Z' };
    expect((await reminderInfo(store, u, NOV(14))).due).toBe(false);
    expect((await reminderInfo(store, u, NOV(15))).due).toBe(true);
    u.statementReminder = { dismissedMonth: '2026-11', lastImportAt: '2026-10-05T10:00:00Z' };
    expect((await reminderInfo(store, u, NOV(20))).due).toBe(false);
    expect((await reminderInfo(store, u, new Date('2026-12-05T12:00:00Z'))).due).toBe(true); // el mes siguiente vuelve
  });

  it('manda un push por la mañana, una sola vez al mes, en el idioma de la cuenta', async () => {
    const sent: string[] = [];
    const send = async (_s: unknown, p: string) => void sent.push(p);
    const store = await setup({}, '2026-10-05T10:00:00Z');
    expect(await runStatementReminders(store, NOV(3, 7), send)).toBe(0); // 08:00 en Berlín: pronto
    expect(await runStatementReminders(store, NOV(3, 10), send)).toBe(1);
    const p = JSON.parse(sent[0]!);
    expect(p.title).toMatch(/extracto/);
    expect(p.body).toMatch(/Ana.*octubre/);
    expect(p.url).toBe('/movimientos?import=1');
    expect(await runStatementReminders(store, NOV(4, 10), send)).toBe(0); // no repite este mes
    expect(await runStatementReminders(store, new Date('2026-12-04T10:00:00Z'), send)).toBe(1); // el mes siguiente sí
  });

  it('sin suscripción push no se manda nada ni se marca', async () => {
    const store = new FileStore({ file: null });
    await store.users.create(user());
    await store.audit.append({ id: 'e1', userId: 'u1', type: 'statement_import', at: '2026-10-05T10:00:00Z', ip: '', detail: '' });
    expect(await runStatementReminders(store, NOV(5, 10), async () => undefined)).toBe(0);
    expect((await store.users.byId('u1'))!.statementReminder?.pushedMonth).toBeUndefined();
  });
});

describe('recordatorio del extracto en la API', () => {
  const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
  it('importar lo apunta, se puede ajustar y descartar', async () => {
    const app: FastifyInstance = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `rem${Date.now()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Ana' } });
    const h = { authorization: `Bearer ${json(res).accessToken}` };
    expect(json(await app.inject({ method: 'GET', url: '/api/import/reminder', headers: h }))).toMatchObject({ enabled: true, day: 3, due: false });
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({ method: 'POST', url: '/api/import/commit', headers: h, payload: { rows: [{ date: today, categoryId: 'groceries', amountMinor: 500, note: 'REWE' }] } });
    const after = json(await app.inject({ method: 'GET', url: '/api/import/reminder', headers: h }));
    expect(after.lastImportAt).toBeTruthy();
    expect(after.due).toBe(false); // ya subió este mes
    expect(json(await app.inject({ method: 'PUT', url: '/api/import/reminder', headers: h, payload: { day: 10, enabled: false } }))).toMatchObject({ day: 10, enabled: false });
    expect((await app.inject({ method: 'PUT', url: '/api/import/reminder', headers: h, payload: { day: 31 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/import/reminder/dismiss', headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/import/reminder' })).statusCode).toBe(401);
    await app.close();
  });
});

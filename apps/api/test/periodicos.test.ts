import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Recurring } from '@econsultor/shared';
import { loadConfig } from '../src/config.js';
import { monthOf, shiftMonth, todayIn } from '../src/lib/dates.js';
import { syncRecurring } from '../src/modules/recurring/service.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';
import type { UserRecord } from '../src/store/types.js';

let app: FastifyInstance;
let store: FileStore;
beforeAll(async () => {
  store = new FileStore({ file: null });
  app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), store);
});
afterAll(() => app.close());

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
async function login() {
  const email = `pe${Date.now()}${Math.random()}@example.com`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'Xk9-mango-lluvia-77', displayName: 'Marcos' } });
  return { email, h: { authorization: `Bearer ${json(res).accessToken}` } as Record<string, string> };
}
const get = async (h: Record<string, string>, url: string) => json(await app.inject({ method: 'GET', url: `/api${url}`, headers: h }));
const send = (h: Record<string, string>, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api${url}`, headers: h, payload });
const txs = async (h: Record<string, string>) => (await get(h, '/transactions?limit=2000')).items as any[];

const TODAY = todayIn('Europe/Berlin');
const THIS = monthOf(TODAY);

/* ───────────────────────── Gastos periódicos ───────────────────────── */

describe('gastos periódicos', () => {
  it('anota cada mes el cargo desde el primer mes hasta hoy y no duplica', async () => {
    const { h } = await login();
    const start = shiftMonth(THIS, -3);
    const res = await send(h, 'POST', '/recurring', { type: 'expense', name: 'Alquiler', amountMinor: 85000, categoryId: 'housing', day: 1, startMonth: start });
    expect(res.statusCode).toBe(201);
    const list = (await txs(h)).filter((t) => t.note === 'Alquiler');
    expect(list.map((t) => t.date).sort()).toEqual([0, 1, 2, 3].map((i) => `${shiftMonth(start, i)}-01`));
    expect(list.every((t) => t.amountMinor === 85000 && t.categoryId === 'housing' && t.type === 'expense' && t.recurringId)).toBe(true);
    // Otra lectura no vuelve a anotar nada.
    expect((await txs(h)).filter((t) => t.note === 'Alquiler')).toHaveLength(4);
    // Un movimiento borrado a mano no reaparece.
    expect((await send(h, 'DELETE', `/transactions/${list[0].id}`)).statusCode).toBe(204);
    expect((await txs(h)).filter((t) => t.note === 'Alquiler')).toHaveLength(3);
  });

  it('por defecto empieza este mes si el día aún no ha llegado y, si ya pasó, el mes que viene', async () => {
    const { h } = await login();
    const dayNow = Number(TODAY.slice(8, 10));
    // Un día que ya pasó (o es hoy) → el próximo mes; uno que aún no llega → este mes.
    const past = await send(h, 'POST', '/recurring', { type: 'expense', name: 'Pasado', amountMinor: 1000, categoryId: 'transport', day: Math.min(dayNow, 28) });
    expect(json(past).startMonth).toBe(shiftMonth(THIS, 1));
    if (dayNow < 28) {
      const fut = await send(h, 'POST', '/recurring', { type: 'expense', name: 'Futuro', amountMinor: 1000, categoryId: 'transport', day: 28 });
      expect(json(fut).startMonth).toBe(THIS);
      expect(json(fut).nextDate).toBe(`${THIS}-28`);
    }
  });

  it('un día 31 cae en el último día de los meses cortos y respeta el último mes', async () => {
    const user: UserRecord = {
      id: randomUUID(), email: 'u@example.com', displayName: 'U', plan: 'free', currency: 'EUR', timezone: 'UTC', reminderEnabled: false, reminderTime: '21:00',
      mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: '', updatedAt: '',
    };
    const r: Recurring = { id: randomUUID(), type: 'expense', amountMinor: 999, categoryId: 'subscriptions', name: 'Netflix', day: 31, startMonth: '2026-01', endMonth: '2026-04', active: true, createdAt: '' };
    user.recurring = [r];
    await store.users.create(user);
    const dates = async () => (await store.transactions.list(user.id)).map((t) => t.date).sort();

    expect(await syncRecurring(store, user, new Date('2026-03-30T12:00:00Z'))).toBe(2);
    expect(await dates()).toEqual(['2026-01-31', '2026-02-28']);
    expect(await syncRecurring(store, user, new Date('2026-03-31T09:00:00Z'))).toBe(1);
    expect(await syncRecurring(store, user, new Date('2026-08-01T09:00:00Z'))).toBe(1); // abril es el último mes
    expect(await dates()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(await syncRecurring(store, user, new Date('2026-12-01T09:00:00Z'))).toBe(0);
  });

  it('en pausa no anota y al reanudar no rellena los meses parados', async () => {
    const { h, email } = await login();
    const start = shiftMonth(THIS, -2);
    const r = json(await send(h, 'POST', '/recurring', { type: 'expense', name: 'Gimnasio', amountMinor: 3000, categoryId: 'health', day: 1, startMonth: start }));
    expect((await txs(h)).filter((t) => t.note === 'Gimnasio')).toHaveLength(3);
    expect(json(await send(h, 'PATCH', `/recurring/${r.id}`, { active: false })).nextDate).toBeUndefined();
    // Simula una pausa larga: el último mes anotado se quedó hace mucho.
    const u = (await store.users.byEmail(email))!;
    u.recurring!.find((x) => x.id === r.id)!.lastGenerated = shiftMonth(THIS, -10);
    await store.users.update(u);
    expect(json(await send(h, 'PATCH', `/recurring/${r.id}`, { active: true })).active).toBe(true);
    expect((await txs(h)).filter((t) => t.note === 'Gimnasio')).toHaveLength(3);
  });

  it('editar solo afecta a lo que viene y borrar conserva lo ya anotado', async () => {
    const { h } = await login();
    const r = json(await send(h, 'POST', '/recurring', { type: 'income', name: 'Nómina', amountMinor: 200000, categoryId: 'salary', day: 1, startMonth: shiftMonth(THIS, -1) }));
    const antes = (await txs(h)).filter((t) => t.note === 'Nómina');
    expect(antes).toHaveLength(2);
    expect(json(await send(h, 'PATCH', `/recurring/${r.id}`, { amountMinor: 210000, name: 'Nómina nueva' })).amountMinor).toBe(210000);
    expect((await txs(h)).filter((t) => t.note === 'Nómina').every((t) => t.amountMinor === 200000)).toBe(true);
    expect((await send(h, 'DELETE', `/recurring/${r.id}`)).statusCode).toBe(204);
    expect((await get(h, '/recurring')).items).toEqual([]);
    expect((await txs(h)).filter((t) => t.note === 'Nómina')).toHaveLength(2);
  });

  it('valida: categoría que no existe, tipo que no corresponde, día fuera de rango y datos de otra persona', async () => {
    const a = await login();
    const b = await login();
    const base = { type: 'expense', name: 'X', amountMinor: 1000, categoryId: 'housing', day: 5 };
    expect((await send(a.h, 'POST', '/recurring', { ...base, categoryId: 'nope' })).statusCode).toBe(400);
    expect((await send(a.h, 'POST', '/recurring', { ...base, categoryId: 'salary' })).statusCode).toBe(400);
    expect((await send(a.h, 'POST', '/recurring', { ...base, day: 32 })).statusCode).toBe(400);
    expect((await send(a.h, 'POST', '/recurring', { ...base, day: 0 })).statusCode).toBe(400);
    expect((await send(a.h, 'POST', '/recurring', { ...base, startMonth: '2026-05', endMonth: '2026-03' })).statusCode).toBe(400);
    expect((await send(a.h, 'POST', '/recurring')).statusCode).toBe(400);
    const r = json(await send(a.h, 'POST', '/recurring', base));
    expect((await send(b.h, 'PATCH', `/recurring/${r.id}`, { amountMinor: 1 })).statusCode).toBe(404);
    expect((await send(b.h, 'DELETE', `/recurring/${r.id}`)).statusCode).toBe(404);
    expect((await get(b.h, '/recurring')).items).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/recurring' })).statusCode).toBe(401);
  });
});

/* ───────────────────────── Categorías propias ───────────────────────── */

describe('categorías propias', () => {
  const put = (h: Record<string, string>, body: object) => send(h, 'PUT', '/me/categories', body);

  it('crea una categoría, se puede usar y aparece en el análisis', async () => {
    const { h } = await login();
    const res = await put(h, { custom: [{ label: 'Mascotas', type: 'expense', family: 'care' }, { label: 'Alquiler habitación', type: 'income' }] });
    expect(res.statusCode).toBe(200);
    const prefs = json(res).categoryPrefs;
    const pet = prefs.custom.find((c: any) => c.label === 'Mascotas');
    const room = prefs.custom.find((c: any) => c.label === 'Alquiler habitación');
    expect(pet.id).toMatch(/^c_[a-z0-9]{8}$/);
    expect(pet.type).toBe('expense');

    const ok = await send(h, 'POST', '/transactions', { type: 'expense', amountMinor: 4500, categoryId: pet.id, date: TODAY, note: 'Veterinario' });
    expect(ok.statusCode).toBe(201);
    // El tipo tiene que corresponder.
    expect((await send(h, 'POST', '/transactions', { type: 'income', amountMinor: 4500, categoryId: pet.id, date: TODAY })).statusCode).toBe(400);
    expect((await send(h, 'POST', '/transactions', { type: 'income', amountMinor: 30000, categoryId: room.id, date: TODAY })).statusCode).toBe(201);
    const o = await get(h, `/analytics/overview?month=${THIS}`);
    expect(o.expenseByCategory.find((c: any) => c.categoryId === pet.id).amountMinor).toBe(4500);
    expect(o.incomeByCategory.find((c: any) => c.categoryId === room.id).amountMinor).toBe(30000);
  });

  it('una categoría propia no vale para otra cuenta, ni en movimientos ni en periódicos ni al importar', async () => {
    const a = await login();
    const b = await login();
    const pet = json(await put(a.h, { custom: [{ label: 'Mascotas', type: 'expense' }] })).categoryPrefs.custom[0];
    expect((await send(b.h, 'POST', '/transactions', { type: 'expense', amountMinor: 100, categoryId: pet.id, date: TODAY })).statusCode).toBe(400);
    expect((await send(b.h, 'POST', '/recurring', { type: 'expense', name: 'X', amountMinor: 100, categoryId: pet.id, day: 3 })).statusCode).toBe(400);
    expect((await send(b.h, 'POST', '/import/commit', { rows: [{ date: TODAY, categoryId: pet.id, amountMinor: 100 }] })).statusCode).toBe(400);
    // Y no puede «adoptar» el id de otra persona colándolo en sus categorías: se le asigna uno nuevo.
    const mine = json(await put(b.h, { custom: [{ id: pet.id, label: 'Otra', type: 'expense' }] })).categoryPrefs.custom[0];
    expect(mine.id).not.toBe(pet.id);
  });

  it('cambia el nombre de las de serie, las oculta y evita nombres repetidos', async () => {
    const { h } = await login();
    const res = json(await put(h, { custom: [], renamed: { housing: 'Mi casa' }, hidden: ['leisure', 'other_expense'] }));
    expect(res.categoryPrefs.renamed).toEqual({ housing: 'Mi casa' });
    // «Otros gastos» no se puede ocultar: ahí caen los movimientos de lo que se borra.
    expect(res.categoryPrefs.hidden).toEqual(['leisure']);
    // Los movimientos de una categoría oculta o renombrada siguen siendo válidos.
    expect((await send(h, 'POST', '/transactions', { type: 'expense', amountMinor: 100, categoryId: 'leisure', date: TODAY })).statusCode).toBe(201);
    // Nombres repetidos.
    expect((await put(h, { custom: [{ label: 'Mi casa', type: 'expense' }], renamed: { housing: 'Mi casa' } })).statusCode).toBe(400);
    expect((await put(h, { custom: [{ label: 'a', type: 'expense' }, { label: 'A ', type: 'expense' }] })).statusCode).toBe(400);
    // Ids que no son de serie se ignoran al renombrar.
    expect(json(await put(h, { custom: [], renamed: { inventada: 'Nada' } })).categoryPrefs.renamed).toEqual({});
    // Nombre vacío o demasiado largo.
    expect((await put(h, { custom: [{ label: '  ', type: 'expense' }] })).statusCode).toBe(400);
    expect((await put(h, { custom: [{ label: 'x'.repeat(31), type: 'expense' }] })).statusCode).toBe(400);
  });

  it('al eliminar una categoría propia sus movimientos y periódicos pasan a «Otros»', async () => {
    const { h } = await login();
    const pet = json(await put(h, { custom: [{ label: 'Mascotas', type: 'expense' }] })).categoryPrefs.custom[0];
    await send(h, 'POST', '/transactions', { type: 'expense', amountMinor: 2500, categoryId: pet.id, date: TODAY });
    await send(h, 'POST', '/recurring', { type: 'expense', name: 'Seguro mascota', amountMinor: 1000, categoryId: pet.id, day: 3, startMonth: shiftMonth(THIS, 1) });
    const res = await put(h, { custom: [] });
    expect(res.statusCode).toBe(200);
    expect(json(res).categoryPrefs.custom).toEqual([]);
    expect((await txs(h)).find((t) => t.amountMinor === 2500).categoryId).toBe('other_expense');
    expect((await get(h, '/recurring')).items[0].categoryId).toBe('other_expense');
    expect((await send(h, 'POST', '/transactions', { type: 'expense', amountMinor: 100, categoryId: pet.id, date: TODAY })).statusCode).toBe(400);
  });

  it('el tipo de una categoría existente no cambia y hay un tope', async () => {
    const { h } = await login();
    const c = json(await put(h, { custom: [{ label: 'Mascotas', type: 'expense' }] })).categoryPrefs.custom[0];
    const again = json(await put(h, { custom: [{ id: c.id, label: 'Animales', type: 'income' }] })).categoryPrefs.custom[0];
    expect(again).toMatchObject({ id: c.id, label: 'Animales', type: 'expense' });
    const many = Array.from({ length: 41 }, (_, i) => ({ label: `Cat ${i}`, type: 'expense' }));
    expect((await put(h, { custom: many })).statusCode).toBe(400);
  });
});

/* ───────────────────────── Informe mensual en PDF ───────────────────────── */

describe('informe mensual en PDF', () => {
  const pdfText = async (r: LightMyRequestResponse): Promise<string> => {
    const doc = await getDocumentProxy(new Uint8Array(r.rawPayload));
    return (await extractText(doc, { mergePages: true })).text;
  };

  async function withData() {
    const { h } = await login();
    const day = (n: number) => `${THIS}-${String(Math.min(n, Number(TODAY.slice(8, 10)))).padStart(2, '0')}`;
    const prev = shiftMonth(THIS, -1);
    const rows = [
      { type: 'income', amountMinor: 250000, categoryId: 'salary', date: `${prev}-05`, note: 'Nómina' },
      { type: 'expense', amountMinor: 80000, categoryId: 'housing', date: `${prev}-03`, note: 'Alquiler' },
      { type: 'expense', amountMinor: 30000, categoryId: 'groceries', date: `${prev}-10`, note: 'Compra' },
      { type: 'expense', amountMinor: 61000, categoryId: 'groceries', date: `${prev}-18`, note: 'Mercadona' },
      { type: 'expense', amountMinor: 19900, categoryId: 'dining', date: `${prev}-20`, note: 'Cena con amigos' },
    ];
    for (const r of rows) expect((await send(h, 'POST', '/transactions', r)).statusCode).toBe(201);
    void day;
    return { h, prev };
  }

  it('devuelve un PDF con el resumen escrito y los datos del mes', async () => {
    const { h, prev } = await withData();
    const res = await app.inject({ method: 'GET', url: `/api/report/monthly?month=${prev}`, headers: h });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`econsultor-${prev}.pdf`);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await pdfText(res);
    expect(text).toContain('Resumen del mes');
    expect(text).toContain('ingresaste');
    expect(text).toContain('Supermercado');
    expect(text).toContain('Mayores gastos del mes');
    expect(text).toContain('Mercadona');
    // El resumen escrito va antes que las tablas de datos.
    expect(text.indexOf('Resumen del mes')).toBeLessThan(text.indexOf('Mayores gastos del mes'));
  });

  it('sale en el idioma de la petición', async () => {
    const { h, prev } = await withData();
    const res = await app.inject({ method: 'GET', url: `/api/report/monthly?month=${prev}`, headers: { ...h, 'x-lang': 'en' } });
    const text = await pdfText(res);
    expect(text).toContain('Month summary');
    expect(text).toContain('you earned');
    const de = await app.inject({ method: 'GET', url: `/api/report/monthly?month=${prev}`, headers: { ...h, 'x-lang': 'de' } });
    expect(await pdfText(de)).toContain('Monatsübersicht');
  });

  it('usa los nombres de categoría de la persona, incluidas las propias, y letras fuera del alfabeto estándar no rompen el PDF', async () => {
    const { h, prev } = await withData();
    const pet = json(await send(h, 'PUT', '/me/categories', { custom: [{ label: 'Mascotas 🐶 Łódź', type: 'expense' }], renamed: { groceries: 'Súper' } })).categoryPrefs.custom[0];
    await send(h, 'POST', '/transactions', { type: 'expense', amountMinor: 9900, categoryId: pet.id, date: `${prev}-12`, note: 'Pienso 🐶 日本語' });
    const res = await app.inject({ method: 'GET', url: `/api/report/monthly?month=${prev}`, headers: h });
    expect(res.statusCode).toBe(200);
    const text = await pdfText(res);
    expect(text).toContain('Súper');
    expect(text).toContain('Mascotas');
  });

  it('un mes sin movimientos también genera un informe, y valida el mes y la sesión', async () => {
    const { h } = await login();
    const res = await app.inject({ method: 'GET', url: `/api/report/monthly?month=2020-02`, headers: h });
    expect(res.statusCode).toBe(200);
    expect(await pdfText(res)).toContain('no hay movimientos anotados');
    expect((await app.inject({ method: 'GET', url: '/api/report/monthly?month=2026-13', headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/report/monthly' })).statusCode).toBe(401);
    // Sin mes, es el mes en curso.
    expect((await app.inject({ method: 'GET', url: '/api/report/monthly', headers: h })).headers['content-disposition']).toContain(`econsultor-${THIS}.pdf`);
  });

  it('incluye los gastos periódicos activos', async () => {
    const { h, prev } = await withData();
    await send(h, 'POST', '/recurring', { type: 'expense', name: 'Netflix', amountMinor: 1299, categoryId: 'subscriptions', day: 12, startMonth: shiftMonth(THIS, 1) });
    const text = await pdfText(await app.inject({ method: 'GET', url: `/api/report/monthly?month=${prev}`, headers: h }));
    expect(text).toContain('Gastos periódicos activos');
    expect(text).toContain('Netflix');
  });
});

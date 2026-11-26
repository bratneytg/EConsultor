import type { FastifyInstance } from 'fastify';
import type { Transaction } from '@econsultor/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { classifyRule } from '../src/modules/ian/agent.js';
import { _reset } from '../src/modules/ian/quota.js';
import { runTool, toolsFor } from '../src/modules/ian/tools.js';
import { _resetNudges, exactKey, unclassifiedGroups } from '../src/modules/ian/unclassified.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const TODAY = '2026-11-26';
const NOW = '2026-11-26T10:00:00.000Z';
let n = 0;
const tx = (note: string, amount: number, categoryId = 'other_expense', type: 'expense' | 'income' = 'expense', date = '2026-11-10'): Transaction =>
  ({ id: `t${++n}`, type, amountMinor: amount, currency: 'EUR', categoryId, date, note, createdAt: NOW, updatedAt: NOW });

const base = (): Transaction[] => [
  tx('Zum Hirschen 4711 · Berlin', 4200), tx('Zum Hirschen 4712', 3800), tx('Zum Hirschen', 2500),
  tx('Zum Ochsen', 1800),                       // otro comercio con la misma primera palabra
  tx('REWE', 2000, 'groceries'),                // ya clasificado: no se toca
  tx('Zum Hirschen', 900, 'dining'),            // mismo comercio pero ya clasificado: no se toca
  tx('Bonus', 5000, 'other_expense', 'income'), // ingreso: no cuenta
];
const user = { currency: 'EUR', recurring: [] as never[], categoryPrefs: undefined };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); _reset(); _resetNudges(); });

describe('gastos sin clasificar', () => {
  it('agrupa por comercio exacto, solo gastos en «Otros»', () => {
    const u = unclassifiedGroups(base());
    expect(u.count).toBe(4);
    expect(u.groups.map((g) => g.label)).toEqual(['Zum Hirschen', 'Zum Ochsen']);
    expect(u.groups[0]!.txs).toHaveLength(3);
    expect(exactKey('REWE SAGT DANKE 4711 · Berlin')).toBe(exactKey('REWE SAGT DANKE 4712'));
    expect(exactKey('Zum Hirschen')).not.toBe(exactKey('Zum Ochsen'));
  });

  it('la herramienta devuelve comercios, importes en euros y las categorías posibles (sin «Otros»)', () => {
    const r = runTool('gastos_sin_clasificar', {}, { user, txs: base(), today: TODAY }) as any;
    expect(r.total_sin_clasificar).toMatchObject({ movimientos: 4, comercios: 2, importe: 123 });
    expect(r.comercios[0]).toMatchObject({ comercio: 'Zum Hirschen', pagos: 3, importe_total: 105 });
    expect(r.categorias_de_gasto).toContain('Ocio');
    expect(r.categorias_de_gasto).not.toContain('Otros gastos');
  });
});

describe('reclasificar_comercio', () => {
  it('cambia solo los gastos de ese comercio que siguen en «Otros» y los guarda', async () => {
    const txs = base();
    const saved: { ids: string[]; cat: string }[] = [];
    const ctx = { user, txs, today: TODAY, reclassify: async (l: Transaction[], cat: string) => { saved.push({ ids: l.map((t) => t.id), cat }); } };
    const r = (await runTool('reclasificar_comercio', { comercio: 'Zum Hirschen', categoria: 'Restaurantes' }, ctx)) as any;
    expect(r).toMatchObject({ cambiados: 3, importe_total: 105 });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.cat).toBe('dining');
    expect(txs.filter((t) => /Hirschen/.test(t.note!) && t.categoryId === 'dining')).toHaveLength(4); // 3 + el que ya lo estaba
    expect(txs.find((t) => t.note === 'Zum Ochsen')!.categoryId).toBe('other_expense');
    expect(txs.find((t) => t.note === 'REWE')!.categoryId).toBe('groceries');
    expect(txs.find((t) => t.type === 'income')!.categoryId).toBe('other_expense');
  });

  it('rechaza categorías que no existen, «Otros», comercios inexistentes y entradas vacías', async () => {
    const ctx = { user, txs: base(), today: TODAY, reclassify: async () => {} };
    await expect(Promise.resolve().then(() => runTool('reclasificar_comercio', { comercio: 'Zum Hirschen', categoria: 'Yates' }, ctx))).rejects.toThrow(/No existe esa categoría/);
    await expect(Promise.resolve().then(() => runTool('reclasificar_comercio', { comercio: 'Zum Hirschen', categoria: 'Otros gastos' }, ctx))).rejects.toThrow();
    await expect(Promise.resolve().then(() => runTool('reclasificar_comercio', { comercio: 'Inventado SL', categoria: 'Ocio' }, ctx))).rejects.toThrow(/No hay gastos sin clasificar/);
    await expect(Promise.resolve().then(() => runTool('reclasificar_comercio', { comercio: '', categoria: 'Ocio' }, ctx))).rejects.toThrow();
  });

  it('sin forma de guardar, la herramienta ni se ofrece ni funciona', async () => {
    expect(toolsFor({}).map((t) => t.name)).not.toContain('reclasificar_comercio');
    expect(toolsFor({ reclassify: async () => {} }).map((t) => t.name)).toContain('reclasificar_comercio');
    await expect(Promise.resolve().then(() => runTool('reclasificar_comercio', { comercio: 'Zum Hirschen', categoria: 'Ocio' }, { user, txs: base(), today: TODAY }))).rejects.toThrow();
  });
});

describe('cuándo saca Ian el tema', () => {
  const rec = async () => {};
  it('solo con permiso, tras contestar, y nunca con casi nada sin clasificar', () => {
    expect(classifyRule({ txs: base(), reclassify: rec, nudge: true })).toMatch(/ESTE mensaje/);
    expect(classifyRule({ txs: base(), reclassify: rec, nudge: false })).toMatch(/No saques el tema/);
    expect(classifyRule({ txs: [tx('Zum Ochsen', 1800)], reclassify: rec, nudge: true })).toMatch(/no saques el tema/);
    expect(classifyRule({ txs: base() })).toMatch(/Movimientos/);
  });
});

describe('Ian en la API: pregunta casual y reclasificación', () => {
  const PASS = 'Xk9-mango-lluvia-77';
  const ADMIN = 'a'.repeat(64);
  const texto = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  const uso = (id: string, name: string, input: unknown) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
  const respuestas = (...bodies: unknown[]) => {
    const f = vi.fn();
    bodies.forEach((b) => f.mockResolvedValueOnce(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', f);
    return f;
  };
  async function montar() {
    const store = new FileStore({ file: null });
    const app: FastifyInstance = await buildApp(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'sk-ant-test', ADMIN_TOKEN: ADMIN } as NodeJS.ProcessEnv), store);
    const email = `cls${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'Ana' } });
    const { accessToken, user: u } = r.json() as { accessToken: string; user: { id: string } };
    await app.inject({ method: 'POST', url: '/api/admin/plan', headers: { 'x-admin-token': ADMIN }, payload: { email, plan: 'premium' } });
    for (const t of base()) await store.transactions.create(u.id, { ...t, date: TODAY });
    return { app, store, id: u.id, h: { authorization: `Bearer ${accessToken}` } };
  }
  const chat = (a: FastifyInstance, h: Record<string, string>, content: string) =>
    a.inject({ method: 'POST', url: '/api/ian/chat', headers: h, payload: { messages: [{ role: 'user', content }] } });
  const systemOf = (f: ReturnType<typeof vi.fn>, call: number): string => JSON.parse((f.mock.calls[call]![1] as { body: string }).body).system;

  it('el estado cuenta los gastos sin clasificar', async () => {
    const { app, h } = await montar();
    const s = (await app.inject({ method: 'GET', url: '/api/ian', headers: h })).json() as { unclassified: number };
    expect(s.unclassified).toBe(4);
    await app.close();
  });

  it('permite sacar el tema una vez al día; después, solo si la persona lo pide', async () => {
    const { app, h } = await montar();
    const f = respuestas(texto('Gastas sobre todo en comida. Por cierto, ¿qué es «Zum Hirschen»?'), texto('Claro.'));
    expect((await chat(app, h, '¿En qué gasto más?')).statusCode).toBe(200);
    expect((await chat(app, h, 'Hola de nuevo')).statusCode).toBe(200);
    expect(systemOf(f, 0)).toMatch(/ESTE mensaje/);
    expect(systemOf(f, 1)).toMatch(/No saques el tema/);
    await app.close();
  });

  it('la persona contesta y Ian reclasifica: se guarda en la cuenta', async () => {
    const { app, store, id, h } = await montar();
    respuestas(
      uso('u1', 'gastos_sin_clasificar', {}),
      uso('u2', 'reclasificar_comercio', { comercio: 'Zum Hirschen', categoria: 'Restaurantes' }),
      texto('Listo: 3 movimientos de Zum Hirschen pasan a Restaurantes.'),
    );
    const r = await chat(app, h, 'Zum Hirschen es un restaurante');
    expect(r.statusCode).toBe(200);
    const all = await store.transactions.list(id);
    expect(all.filter((t) => /Hirschen/.test(t.note ?? '') && t.categoryId === 'dining')).toHaveLength(4);
    expect(all.find((t) => t.note === 'Zum Ochsen')!.categoryId).toBe('other_expense');
    expect(((await app.inject({ method: 'GET', url: '/api/ian', headers: h })).json() as { unclassified: number }).unclassified).toBe(0);
    await app.close();
  });
});

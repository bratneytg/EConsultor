import type { Transaction } from '@econsultor/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';
import { noteRule } from '../src/modules/ian/agent.js';
import { runTool, toolsFor, type IanContext } from '../src/modules/ian/tools.js';

const TODAY = '2026-11-26';
const user = { currency: 'EUR', recurring: [] as never[], categoryPrefs: undefined };

function ctx(txs: Transaction[] = []) {
  const saved: Transaction[] = [];
  const removed: string[] = [];
  const c: IanContext = {
    user, txs, today: TODAY,
    create: async (t) => { saved.push(t); },
    remove: async (t) => { removed.push(t.id); },
  };
  return { c, saved, removed, txs };
}

describe('Ian anota movimientos', () => {
  it('las herramientas solo existen si hay forma de guardar el cambio', () => {
    const names = (x: Parameters<typeof toolsFor>[0]) => toolsFor(x).map((t) => t.name);
    expect(names({})).not.toContain('crear_movimiento');
    expect(names({})).not.toContain('deshacer_ultimo_movimiento');
    expect(names({ create: async () => undefined })).toContain('crear_movimiento');
    expect(names({ remove: async () => undefined })).toContain('deshacer_ultimo_movimiento');
    expect(noteRule({})).toMatch(/no puedes anotar/);
    expect(noteRule({ create: async () => undefined })).toMatch(/crear_movimiento/);
  });

  it('anota un gasto con la categoría deducida del comercio y lo marca como de Ian', async () => {
    const { c, saved, txs } = ctx();
    const r = (await runTool('crear_movimiento', { tipo: 'gasto', importe: 12.5, concepto: 'Mercadona' }, c)) as any;
    expect(r.anotado).toMatchObject({ tipo: 'gasto', importe: 12.5, concepto: 'Mercadona', fecha: TODAY });
    expect(r.categoria_segura).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'expense', amountMinor: 1250, categoryId: 'groceries', date: TODAY, source: 'ian', currency: 'EUR' });
    expect(txs).toContain(saved[0]); // las consultas siguientes ya lo ven
  });

  it('si no reconoce el comercio lo deja en «Otros» y lo dice', async () => {
    const { c, saved } = ctx();
    const r = (await runTool('crear_movimiento', { tipo: 'gasto', importe: 8, concepto: 'Xyqor Holding' }, c)) as any;
    expect(saved[0]!.categoryId).toBe('other_expense');
    expect(r.categoria_segura).toBe(false);
    expect(r.nota).toMatch(/Otros/);
  });

  it('respeta la categoría que dijo la persona, por nombre, y valida el tipo', async () => {
    const { c, saved } = ctx();
    await runTool('crear_movimiento', { tipo: 'gasto', importe: 30, concepto: 'Cena con Ana', categoria: 'Restaurantes', fecha: '2026-11-25' }, c);
    expect(saved[0]).toMatchObject({ categoryId: 'dining', date: '2026-11-25' });
    expect(() => runTool('crear_movimiento', { tipo: 'gasto', importe: 5, concepto: 'x', categoria: 'Nómina' }, c)).toThrow(/No existe esa categoría/);
  });

  it('anota ingresos', async () => {
    const { c, saved } = ctx();
    await runTool('crear_movimiento', { tipo: 'ingreso', importe: 50, concepto: 'Ana' }, c);
    expect(saved[0]).toMatchObject({ type: 'income', amountMinor: 5000 });
    expect(saved[0]!.categoryId).toBe('other_income');
  });

  it('rechaza futuros, importes raros y conceptos vacíos', () => {
    const { c } = ctx();
    expect(() => runTool('crear_movimiento', { tipo: 'gasto', importe: 5, concepto: 'Café', fecha: '2026-12-30' }, c)).toThrow(/futuro/);
    expect(() => runTool('crear_movimiento', { tipo: 'gasto', importe: -5, concepto: 'Café' }, c)).toThrow();
    expect(() => runTool('crear_movimiento', { tipo: 'gasto', importe: 5, concepto: '' }, c)).toThrow();
    expect(() => runTool('crear_movimiento', { tipo: 'gasto', importe: 0.001, concepto: 'Café' }, c)).toThrow();
  });

  it('deshace el último movimiento de Ian de la última hora, y solo ese', async () => {
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const manual: Transaction = { id: 'm1', type: 'expense', amountMinor: 100, currency: 'EUR', categoryId: 'dining', date: TODAY, createdAt: new Date().toISOString(), updatedAt: old };
    const stale: Transaction = { id: 's1', type: 'expense', amountMinor: 200, currency: 'EUR', categoryId: 'dining', date: TODAY, source: 'ian', createdAt: old, updatedAt: old };
    const { c, removed, txs } = ctx([manual, stale]);
    expect(() => runTool('deshacer_ultimo_movimiento', {}, c)).toThrow(/última hora/);
    await runTool('crear_movimiento', { tipo: 'gasto', importe: 9, concepto: 'Lidl' }, c);
    const mine = txs.find((t) => t.source === 'ian' && t.id !== 's1')!;
    const r = (await runTool('deshacer_ultimo_movimiento', {}, c)) as any;
    expect(r.borrado).toMatchObject({ importe: 9, tipo: 'gasto' });
    expect(removed).toEqual([mine.id]);
    expect(txs.map((t) => t.id)).toEqual(['m1', 's1']); // lo anotado a mano y lo antiguo no se tocan
  });
});

describe('Ian anota desde el chat (con la IA simulada)', () => {
  afterEach(() => vi.unstubAllGlobals());
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
    const email = `ano${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'Ana' } });
    const { accessToken, user: u } = r.json() as { accessToken: string; user: { id: string } };
    await app.inject({ method: 'POST', url: '/api/admin/plan', headers: { 'x-admin-token': ADMIN }, payload: { email, plan: 'premium' } });
    return { app, store, id: u.id, h: { authorization: `Bearer ${accessToken}` } };
  }
  const chat = (a: FastifyInstance, h: Record<string, string>, content: string) =>
    a.inject({ method: 'POST', url: '/api/ian/chat', headers: h, payload: { messages: [{ role: 'user', content }] } });

  it('«he gastado 12 en el súper» queda guardado en la cuenta; deshacer lo borra', async () => {
    const { app, store, id, h } = await montar();
    respuestas(uso('u1', 'crear_movimiento', { tipo: 'gasto', importe: 12, concepto: 'Mercadona' }), texto('Anotado: 12 € en Mercadona (Supermercado), hoy.'));
    const r = await chat(app, h, 'He gastado 12 € en el súper');
    expect(r.statusCode).toBe(200);
    expect((r.json() as { changed?: boolean }).changed).toBe(true);
    const all = await store.transactions.list(id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ amountMinor: 1200, categoryId: 'groceries', source: 'ian', note: 'Mercadona' });

    respuestas(uso('u2', 'deshacer_ultimo_movimiento', {}), texto('Hecho, lo he borrado.'));
    await chat(app, h, 'Me equivoqué, bórralo');
    expect(await store.transactions.list(id)).toHaveLength(0);
    await app.close();
  });
});

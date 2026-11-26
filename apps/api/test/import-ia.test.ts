import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { groupMerchants, isPrivateTransfer, readArray } from '../src/modules/import/identify.js';
import { importJobs } from '../src/modules/import/jobs.js';
import { _resetLookups, grantLookups, lookupsLeft, refundLookups } from '../src/modules/import/quota.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const CSV = `"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"
"2026-11-02","2026-11-02","REWE Markt","","Presentment","","Main Account","-23.45","","",""
"2026-11-04","2026-11-04","Xyqor Holding","","Presentment","","Main Account","-18.00","","",""
"2026-11-05","2026-11-05","Xyqor Holding","","Presentment","","Main Account","-9.50","","",""
"2026-11-06","2026-11-06","Qwertz Brandl","","Presentment","","Main Account","-64.90","","",""
"2026-11-07","2026-11-07","Anna Beispiel","DE89370400440532013000","Outgoing Transfer","Danke","Main Account","-50.00","","",""
`;

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'sk-ant-test' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
});
afterAll(() => app.close());
beforeEach(() => { _resetLookups(); importJobs._reset(); });
afterEach(() => vi.unstubAllGlobals());

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
async function login() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `ia${Date.now()}${Math.random()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Ana' } });
  return { authorization: `Bearer ${json(res).accessToken}` };
}
const reply = (text: string, stop = 'end_turn') => ({ ok: true, status: 200, json: async () => ({ stop_reason: stop, content: [{ type: 'text', text }] }) });

/** Simula la API de Anthropic: devuelve lo que decida `answer` y guarda las peticiones. */
function mockAnthropic(answer: (body: any) => ReturnType<typeof reply> | { ok: false; status: number }) {
  const calls: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => { const b = JSON.parse(init.body); calls.push(b); return answer(b); }));
  return calls;
}
async function waitJob(h: Record<string, string>, id: string) {
  for (let i = 0; i < 100; i++) {
    const j = json(await app.inject({ method: 'GET', url: `/api/import/jobs/${id}`, headers: h }));
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('la tarea no termina');
}

describe('piezas de la identificación', () => {
  it('agrupa por comercio y no manda IBAN ni correos', () => {
    const { merchants, idx } = groupMerchants([
      { i: 0, raw: { date: '2026-11-01', amountMinor: -1000, name: 'Xyqor Holding' } },
      { i: 1, raw: { date: '2026-11-02', amountMinor: -3000, name: 'Xyqor Holding', reference: 'DE89370400440532013000 a@b.de' } },
    ]);
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toMatchObject({ count: 2, amount: 20, type: 'expense' });
    expect(merchants[0]!.text).not.toMatch(/DE89|a@b\.de/);
    expect([...idx.values()][0]).toEqual([0, 1]);
  });

  it('las transferencias a personas no se consideran comercios', () => {
    expect(isPrivateTransfer({ name: 'Anna Beispiel', kind: 'Outgoing Transfer', reference: 'Danke' })).toBe(true);
    expect(isPrivateTransfer({ name: 'Xyqor Holding', kind: 'Presentment' })).toBe(false);
  });

  it('lee el array aunque venga con vallas o cortado', () => {
    expect(readArray('```json\n[{"k":"a"}]\n```')).toEqual([{ k: 'a' }]);
    expect(readArray('[{"k":"a"},{"k":"b"},{"k":"c')).toEqual([{ k: 'a' }, { k: 'b' }]);
    expect(readArray('sin json')).toEqual([]);
  });

  it('el cupo diario concede, descuenta y devuelve', () => {
    expect(grantLookups('u', '2026-11-26', 10, 7)).toBe(7);
    expect(grantLookups('u', '2026-11-26', 10, 7)).toBe(3);
    expect(lookupsLeft('u', '2026-11-26', 10)).toBe(0);
    refundLookups('u', '2026-11-26', 4);
    expect(lookupsLeft('u', '2026-11-26', 10)).toBe(4);
    expect(lookupsLeft('u', '2026-11-27', 10)).toBe(10); // otro día
  });
});

describe('tareas de análisis', () => {
  it('sube una vez, devuelve el id y entrega el resultado al consultar', async () => {
    const h = await login();
    const start = await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, key: 'clave-uno-123' } });
    expect(start.statusCode).toBe(202);
    const id = json(start).id as string;
    const done = await waitJob(h, id);
    expect(done.status).toBe('done');
    expect(done.result.rows.length).toBe(5);
  });

  it('reintentar con la misma clave no crea otra tarea', async () => {
    const h = await login();
    const a = json(await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, key: 'clave-dos-123' } }));
    const b = json(await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, key: 'clave-dos-123' } }));
    expect(b.id).toBe(a.id);
  });

  it('solo su dueña la ve y la puede descartar', async () => {
    const h = await login();
    const other = await login();
    const id = json(await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, key: 'clave-tres-123' } })).id as string;
    expect((await app.inject({ method: 'GET', url: `/api/import/jobs/${id}`, headers: other })).statusCode).toBe(404);
    await waitJob(h, id);
    expect((await app.inject({ method: 'DELETE', url: `/api/import/jobs/${id}`, headers: h })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/import/jobs/${id}`, headers: h })).statusCode).toBe(404);
  });

  it('un archivo ilegible acaba en error con mensaje, no en una tarea colgada', async () => {
    const h = await login();
    const id = json(await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: 'esto no es un extracto bancario', key: 'clave-cuatro-123' } })).id as string;
    const done = await waitJob(h, id);
    expect(done.status).toBe('error');
    expect(done.error.message).toBeTruthy();
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/import/jobs', payload: { kind: 'csv', content: CSV, key: 'clave-cinco-123' } })).statusCode).toBe(401);
  });
});

describe('identificación de comercios con IA', () => {
  it('primero usa lo que sabe; busca en internet solo lo que no sabe; no manda a personas', async () => {
    const calls = mockAnthropic((b) => {
      const sent = JSON.parse(b.messages[0].content) as { k: string; t: string }[];
      if (b.tools) { // pasada con búsqueda web
        return reply(JSON.stringify(sent.map((m) => ({ k: m.k, c: 'leisure', d: 'Escuela de escalada', s: 2 }))));
      }
      return reply(JSON.stringify(sent.map((m) => (/xyqor/i.test(m.t) ? { k: m.k, c: 'dining', d: 'Bar de copas', s: 2 } : { k: m.k, c: 'other_expense', d: '', s: 0 }))));
    });
    const h = await login();
    const id = json(await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, useAi: true, key: 'clave-seis-123' } })).id as string;
    const done = await waitJob(h, id);
    expect(done.status).toBe('done');
    const rows = done.result.rows as { note: string; categoryId: string; via: string; hint?: string; web?: boolean }[];
    const xy = rows.filter((r) => /xyqor/i.test(r.note));
    expect(xy).toHaveLength(2);
    expect(xy.every((r) => r.categoryId === 'dining' && r.via === 'ai' && r.hint === 'Bar de copas' && !r.web)).toBe(true);
    const qw = rows.find((r) => /qwertz/i.test(r.note))!;
    expect(qw).toMatchObject({ categoryId: 'leisure', via: 'ai', web: true });
    // La transferencia a una persona no sale del servidor.
    expect(JSON.stringify(calls)).not.toMatch(/Anna Beispiel/);
    // Un comercio repetido es una sola pregunta.
    const knowledge = calls.find((c) => !c.tools)!;
    expect((JSON.parse(knowledge.messages[0].content) as unknown[]).filter((m: any) => /xyqor/i.test(m.t))).toHaveLength(1);
    expect(done.result.ai).toMatchObject({ identified: 3, web: 1 });
  });

  it('si la búsqueda web no está disponible, se queda con lo que sabe y avisa', async () => {
    mockAnthropic((b) => {
      if (b.tools) return { ok: false, status: 400 };
      const sent = JSON.parse(b.messages[0].content) as { k: string; t: string }[];
      return reply(JSON.stringify(sent.map((m) => ({ k: m.k, c: 'other_expense', d: '', s: 0 }))));
    });
    const h = await login();
    const id = json(await app.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, useAi: true, key: 'clave-siete-123' } })).id as string;
    const done = await waitJob(h, id);
    expect(done.status).toBe('done');
    expect(done.result.ai.problem).toBe('web_unavailable');
    expect(done.result.warnings.join(' ')).toMatch(/búsqueda en internet/);
  });

  it('sin cupo diario no busca en internet y lo dice', async () => {
    const calls = mockAnthropic((b) => {
      const sent = JSON.parse(b.messages[0].content) as { k: string }[];
      return reply(JSON.stringify(sent.map((m) => ({ k: m.k, c: 'other_expense', d: '', s: 0 }))));
    });
    const quotaApp = await buildApp(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'sk-ant-test', IMPORT_WEB_LOOKUPS_DAILY: '0' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
    const res = await quotaApp.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `q${Date.now()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Ana' } });
    const h = { authorization: `Bearer ${json(res).accessToken}` };
    const start = await quotaApp.inject({ method: 'POST', url: '/api/import/jobs', headers: h, payload: { kind: 'csv', content: CSV, useAi: true, key: 'clave-ocho-123' } });
    const id = json(start).id as string;
    let done: Record<string, any> = {};
    for (let i = 0; i < 100 && done.status !== 'done'; i++) { await new Promise((r) => setTimeout(r, 20)); done = json(await quotaApp.inject({ method: 'GET', url: `/api/import/jobs/${id}`, headers: h })); }
    expect(done.status).toBe('done');
    expect(calls.some((c) => c.tools)).toBe(false);
    await quotaApp.close();
  });

  it('/classify reclasifica solo lo que se le pasa', async () => {
    mockAnthropic((b) => {
      const sent = JSON.parse(b.messages[0].content) as { k: string }[];
      return reply(JSON.stringify(sent.map((m) => ({ k: m.k, c: 'transport', d: 'Autobús', s: 2 }))));
    });
    const h = await login();
    const start = await app.inject({ method: 'POST', url: '/api/import/classify', headers: h, payload: { key: 'clave-nueve-123', items: [{ id: 'r1', text: 'Xyqor Holding', amountMinor: -1800 }] } });
    expect(start.statusCode).toBe(202);
    const done = await waitJob(h, json(start).id);
    expect(done.status).toBe('done');
    expect(done.result.results).toEqual([{ id: 'r1', categoryId: 'transport', hint: 'Autobús', web: false }]);
  });

  it('la IA no puede poner una categoría de ingreso a un gasto', async () => {
    mockAnthropic((b) => {
      const sent = JSON.parse(b.messages[0].content) as { k: string }[];
      return reply(JSON.stringify(sent.map((m) => ({ k: m.k, c: 'salary', d: 'Sueldo', s: 2 }))));
    });
    const h = await login();
    const start = await app.inject({ method: 'POST', url: '/api/import/classify', headers: h, payload: { key: 'clave-diez-123', items: [{ id: 'r1', text: 'Xyqor Holding', amountMinor: -1800 }] } });
    const done = await waitJob(h, json(start).id);
    expect(done.result.results).toEqual([]);
  });
});

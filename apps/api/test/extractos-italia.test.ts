import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { parseAmount, parseDate } from '../src/modules/import/parse.js';
import { resolveSigns } from '../src/modules/import/signs.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';
import { makeOds, makeXlsx, type Cell } from './fixtures/xlsx.js';

/*
 * Los PDF de «nexi-carta-*.pdf» son SINTÉTICOS: reproducen el aspecto típico de un estracto de tarjeta italiano
 * (dos fechas, descripción, importe en EUR, gastos en positivo) pero no son un documento real de Nexi.
 */

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
});
afterAll(() => app.close());

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
async function login() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `it${Date.now()}${Math.random()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Giulia' } });
  return { authorization: `Bearer ${json(res).accessToken}` };
}
const send = (h: Record<string, string>, kind: 'csv' | 'pdf' | 'sheet', content: string, extra: object = {}) =>
  app.inject({ method: 'POST', url: '/api/import/preview', headers: h, payload: { kind, content, ...extra } });
const pdf = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString('base64');
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const byNote = (body: any, text: string) => body.rows.find((r: any) => r.note.toLowerCase().includes(text.toLowerCase()));

describe('extracto de tarjeta con los gastos en positivo (estilo Nexi, PDF)', () => {
  it('cuenta los gastos como gastos y las devoluciones como ingresos', async () => {
    const h = await login();
    const p = await send(h, 'pdf', pdf('nexi-carta-positivos.pdf'));
    expect(p.statusCode).toBe(200);
    const body = json(p);
    expect(body.signs.mode).toBe('unsigned');
    expect(body.rows).toHaveLength(14);
    for (const t of ['esselunga', 'trenitalia', 'ristorante', 'amazon eu', 'farmacia', 'netflix', 'q8', 'zalando italia', 'conad', 'enel', 'bar pasticceria']) {
      expect(byNote(body, t).type, t).toBe('expense');
    }
    expect(byNote(body, 'storno').type).toBe('income');
    expect(byNote(body, 'storno').categoryId).toBe('refunds');
    // El pago de la tarjeta no es un ingreso real: viene desmarcado.
    expect(byNote(body, 'pagamento ricevuto').skip).toBe('internal');
    // En moneda extranjera cuenta lo cobrado en euros.
    expect(byNote(body, 'amazon.com').amountMinor).toBe(2310);
    expect(byNote(body, 'amazon.com').note).not.toMatch(/USD/);
    expect(body.stats.expense).toBe(12); // 14 líneas: menos el storno (ingreso) y el pago de la tarjeta (desmarcado)
  });

  it('categoriza lo habitual de Italia', async () => {
    const h = await login();
    const body = json(await send(h, 'pdf', pdf('nexi-carta-positivos.pdf')));
    const cat = (t: string) => byNote(body, t).categoryId;
    expect(cat('esselunga')).toBe('groceries');
    expect(cat('conad')).toBe('groceries');
    expect(cat('trenitalia')).toBe('transport');
    expect(cat('q8')).toBe('transport');
    expect(cat('ristorante')).toBe('dining');
    expect(cat('farmacia')).toBe('health');
    expect(cat('enel')).toBe('utilities');
    expect(cat('netflix')).toBe('subscriptions');
    expect(cat('amazon eu')).toBe('shopping');
  });

  it('si los abonos vienen en negativo, también se entienden (signo invertido)', async () => {
    const h = await login();
    const body = json(await send(h, 'pdf', pdf('nexi-carta-abonos-negativos.pdf')));
    expect(body.signs.mode).toBe('inverted');
    expect(byNote(body, 'esselunga').type).toBe('expense');
    expect(byNote(body, 'storno').type).toBe('income');
    expect(byNote(body, 'pagamento ricevuto').skip).toBe('internal');
    expect(body.stats.expenseMinor).toBeGreaterThan(body.stats.incomeMinor);
  });

  it('«Invertir gastos e ingresos» da la vuelta a todo si aun así salía al revés', async () => {
    const h = await login();
    const body = json(await send(h, 'pdf', pdf('nexi-carta-positivos.pdf'), { flipSigns: true }));
    expect(body.signs.flipped).toBe(true);
    expect(byNote(body, 'esselunga').type).toBe('income');
    expect(byNote(body, 'storno').type).toBe('expense');
  });
});

describe('resolución de signos', () => {
  const row = (name: string, amountMinor: number) => ({ date: '2026-11-03', amountMinor, name });

  it('una cuenta normal (gastos negativos, nómina positiva) no se toca', () => {
    const rows = [row('REWE Markt', -2345), row('LIDL', -1999), row('Stipendio DHL', 243120), row('Netflix', -1399), row('ENEL', -7430), row('Esselunga', -4217), row('Conad', -1105)];
    const r = resolveSigns(rows, 'Estratto conto conto corrente');
    expect(r.mode).toBe('normal');
    expect(r.rows.map((x) => x.amountMinor)).toEqual(rows.map((x) => x.amountMinor));
  });

  it('todo positivo sin pistas: gasto por defecto; ingreso solo lo que lo dice', () => {
    const r = resolveSigns([row('PIZZERIA ROMA', 2500), row('Pagamento sconosciuto XYZ', 1000), row('Stipendio novembre', 180000)], 'Movimenti');
    expect(r.mode).toBe('unsigned');
    expect(r.rows.map((x) => Math.sign(x.amountMinor))).toEqual([-1, -1, 1]);
  });

  it('la columna «tipo» del propio extracto manda cuando no hay signos', () => {
    const r = resolveSigns([{ ...row('Operazione A', 1000), hint: 'credit' as const }, { ...row('Operazione B', 2000), hint: 'debit' as const }], '');
    expect(r.rows.map((x) => Math.sign(x.amountMinor))).toEqual([1, -1]);
  });

  it('con signos mixtos y comercios en positivo (tarjeta sin cabecera clara), detecta la inversión por las descripciones', () => {
    const rows = [
      row('ESSELUNGA', 4000), row('CONAD', 3000), row('TRENITALIA', 5000), row('RISTORANTE X', 6000), row('FARMACIA', 1500), row('ENEL ENERGIA', 8000),
      row('RIMBORSO AMAZON', -2000),
    ];
    const r = resolveSigns(rows, 'Lista movimenti');
    expect(r.mode).toBe('inverted');
    expect(r.rows[0]!.amountMinor).toBe(-4000);
    expect(r.rows[6]!.amountMinor).toBe(2000);
  });
});

describe('formatos de importe y fecha de Italia', () => {
  it('importes y fechas', () => {
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('€ -12,30')).toBe(-1230);
    expect(parseAmount('12,30+')).toBe(1230);
    expect(parseAmount('12,30-')).toBe(-1230);
    expect(parseDate('05/11/2026')).toBe('2026-11-05');
    expect(parseDate('5 nov 2026')).toBe('2026-11-05');
    expect(parseDate('05 novembre 2026')).toBe('2026-11-05');
    expect(parseDate('5. Nov. 2026')).toBe('2026-11-05');
    expect(parseDate('3 dic 26')).toBe('2026-12-03');
    expect(parseDate('3 gennaio 2026')).toBe('2026-01-03');
    expect(parseDate('31 feb 2026')).toBeNull();
  });
});

const NEXI_ROWS: Cell[][] = [
  ['Estratto conto Nexi - Carta di credito ****4321'],
  [],
  ['Data operazione', 'Data registrazione', 'Descrizione', 'Importo in EUR'],
  [{ date: '2026-11-03' }, { date: '2026-11-04' }, 'ESSELUNGA MILANO MI', 42.17],
  [{ date: '2026-11-05' }, { date: '2026-11-06' }, 'TRATTORIA DA GINO', 58],
  [{ date: '2026-11-08' }, { date: '2026-11-09' }, 'STORNO ZALANDO ITALIA', 49.95],
  [{ date: '2026-11-10' }, { date: '2026-11-11' }, 'ITALO TRENO', 39.9],
  [{ date: '2026-11-12' }, { date: '2026-11-13' }, 'Q8 EASY', 61.25],
  [],
  ['Totale', '', '', 251.27],
];

describe('importar desde Excel (.xlsx) y LibreOffice (.ods)', () => {
  it('lee un Excel con cabeceras italianas, fechas reales y gastos en positivo', async () => {
    const h = await login();
    const p = await send(h, 'sheet', b64(makeXlsx([{ name: 'Movimenti', rows: NEXI_ROWS }])));
    expect(p.statusCode).toBe(200);
    const body = json(p);
    expect(body.source).toBe('sheet');
    expect(body.rows).toHaveLength(5);
    expect(body.signs.mode).toBe('unsigned');
    expect(byNote(body, 'esselunga')).toMatchObject({ date: '2026-11-03', type: 'expense', categoryId: 'groceries', amountMinor: 4217 });
    expect(byNote(body, 'trattoria').categoryId).toBe('dining');
    expect(byNote(body, 'italo').categoryId).toBe('transport');
    expect(byNote(body, 'storno')).toMatchObject({ type: 'income', categoryId: 'refunds' });
    expect(body.stats.expense).toBe(4);
  });

  it('cadenas incrustadas (inlineStr), hojas ocultas y hoja correcta entre varias', async () => {
    const h = await login();
    const file = makeXlsx(
      [
        { name: 'Oculta', rows: [['nada']], hidden: true },
        { name: 'Resumen', rows: [['Resumen de cuenta'], ['sin movimientos']] },
        { name: 'Movimenti', rows: NEXI_ROWS },
      ],
      { sharedStrings: false },
    );
    const body = json(await send(h, 'sheet', b64(file)));
    expect(body.rows).toHaveLength(5);
  });

  it('columnas separadas de Dare/Avere o Uscite/Entrate (siempre en positivo)', async () => {
    const h = await login();
    const rows: Cell[][] = [
      ['Data', 'Descrizione', 'Uscite', 'Entrate'],
      [{ date: '2026-11-03' }, 'CONAD CITY', 25.5, null],
      [{ date: '2026-11-04' }, 'Bonifico stipendio DHL', null, 1800],
      [{ date: '2026-11-05' }, 'Affitto novembre', 700, null],
    ];
    const body = json(await send(h, 'sheet', b64(makeXlsx([{ name: 'C/C', rows }]))));
    expect(byNote(body, 'conad')).toMatchObject({ type: 'expense', amountMinor: 2550, categoryId: 'groceries' });
    expect(byNote(body, 'stipendio')).toMatchObject({ type: 'income', categoryId: 'salary', amountMinor: 180000 });
    expect(byNote(body, 'affitto')).toMatchObject({ type: 'expense', categoryId: 'housing' });
    expect(body.signs.mode).toBe('normal');
  });

  it('columna «Segno» o «Tipo movimento» cuando los importes no llevan signo', async () => {
    const h = await login();
    const rows: Cell[][] = [
      ['Data operazione', 'Descrizione', 'Importo', 'Tipo movimento'],
      ['03/11/2026', 'MOVIMENTO A', 100, 'Addebito'],
      ['04/11/2026', 'MOVIMENTO B', 250, 'Accredito'],
      ['05/11/2026', 'MOVIMENTO C', 30, 'Addebito'],
    ];
    const body = json(await send(h, 'sheet', b64(makeXlsx([{ name: 'M', rows }]))));
    expect(byNote(body, 'movimento a').type).toBe('expense');
    expect(byNote(body, 'movimento b').type).toBe('income');
    expect(byNote(body, 'movimento c').type).toBe('expense');
  });

  it('lee un .ods de LibreOffice', async () => {
    const h = await login();
    const body = json(await send(h, 'sheet', b64(makeOds('Movimenti', NEXI_ROWS))));
    expect(body.rows).toHaveLength(5);
    expect(byNote(body, 'esselunga')).toMatchObject({ date: '2026-11-03', type: 'expense' });
  });

  it('explica qué hacer con un .xls antiguo, un archivo que no es Excel o un Excel sin movimientos', async () => {
    const h = await login();
    const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(200)]);
    const old = await send(h, 'sheet', xls.toString('base64'));
    expect(old.statusCode).toBe(422);
    expect(json(old).error?.message ?? json(old).message).toMatch(/\.xlsx|CSV/);
    const junk = await send(h, 'sheet', Buffer.from('esto no es un excel '.repeat(10)).toString('base64'));
    expect(junk.statusCode).toBe(422);
    const empty = await send(h, 'sheet', b64(makeXlsx([{ name: 'X', rows: [['Nombre', 'Edad'], ['Ana', 3]] }])));
    expect(empty.statusCode).toBe(422);
    expect(JSON.stringify(json(empty))).toMatch(/fecha e importe/);
  });

  it('rechaza un zip que se descomprime en cantidades absurdas (zip bomb)', async () => {
    const h = await login();
    const big = zipSync({ 'xl/workbook.xml': new Uint8Array(130 * 1024 * 1024) }, { level: 1 });
    const r = await send(h, 'sheet', b64(big));
    expect(r.statusCode).toBe(422);
    expect(JSON.stringify(json(r))).toMatch(/demasiado grande/);
  });
});

import { readFileSync } from 'node:fs';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { categorize } from '../src/modules/import/categorize.js';
import { rowsFromCsv } from '../src/modules/import/csv.js';
import { parseAmount, parseDate } from '../src/modules/import/parse.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const N26_EN = `"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"
"2026-11-02","2026-11-02","REWE Markt","","Presentment","","Main Account","-23.45","","",""
"2026-11-03","2026-11-03","Vermieter Schmidt","DE89370400440532013000","Outgoing Transfer","Miete November","Main Account","-780.00","","",""
"2026-11-05","2026-11-05","DHL Group","DE02120300000000202051","Income","Gehalt Oktober","Main Account","2431.20","","",""
"2026-11-06","2026-11-06","Netflix.com","","Direct Debit","","Main Account","-13.99","","",""
"2026-11-08","2026-11-08","Urlaub","","Space transfer","Umbuchung to Space Urlaub","Main Account","-100.00","","",""
"2026-11-09","2026-11-09","Kiosk Schulz","","Presentment","","Main Account","-4.20","","",""
"2026-11-09","2026-11-09","Kiosk Schulz","","Presentment","","Main Account","-4.20","","",""
"2026-11-12","2026-11-12","Tankstelle Jet","","Presentment","","Main Account","-52.10","","",""
`;

const N26_DE = `Buchungsdatum;Wertstellung;Partnername;Partner IBAN;Typ;Verwendungszweck;Kontoname;Betrag (EUR)
03.11.2026;03.11.2026;Lidl Dienstleistung;;Kartenzahlung;;Hauptkonto;-15,67
13.11.2026;13.11.2026;Amazon Payments;;Lastschrift;Bestellung 305;Hauptkonto;-1.234,56
15.11.2026;15.11.2026;Finanzamt;;Gutschrift;Steuererstattung;Hauptkonto;+310,00
`;

describe('lectura de importes y fechas', () => {
  it('importes europeos, anglosajones y con marcadores', () => {
    expect(parseAmount('-23,45')).toBe(-2345);
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('(12.34)')).toBe(-1234);
    expect(parseAmount('12,34-')).toBe(-1234);
    expect(parseAmount('45,00 S')).toBe(-4500);
    expect(parseAmount('45,00 H')).toBe(4500);
    expect(parseAmount('+310,00 €')).toBe(31000);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('0,00')).toBeNull();
  });

  it('fechas ISO y europeas; rechaza las imposibles', () => {
    expect(parseDate('2026-11-02')).toBe('2026-11-02');
    expect(parseDate('02.11.2026')).toBe('2026-11-02');
    expect(parseDate('02/11/26')).toBe('2026-11-02');
    expect(parseDate('11/02/2026', false)).toBe('2026-11-02');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('03.11.', true, 2026)).toBe('2026-11-03');
  });
});

describe('CSV de N26', () => {
  it('lee la exportación en inglés', () => {
    const { rows } = rowsFromCsv(N26_EN);
    expect(rows).toHaveLength(8);
    expect(rows[2]).toMatchObject({ date: '2026-11-05', amountMinor: 243120, name: 'DHL Group', reference: 'Gehalt Oktober' });
  });

  it('lee la exportación alemana con punto y coma y coma decimal', () => {
    const { rows } = rowsFromCsv(N26_DE);
    expect(rows.map((r) => r.amountMinor)).toEqual([-1567, -123456, 31000]);
    expect(rows[0]!.date).toBe('2026-11-03');
  });

  it('avisa si no reconoce las columnas', () => {
    expect(() => rowsFromCsv('a,b,c\n1,2,3')).toThrow(/No reconozco las columnas/);
  });
});

describe('categorización sin conexión', () => {
  it('reconoce comercios habituales y el signo decide gasto/ingreso', () => {
    const c = (name: string, amountMinor: number, extra = {}) => categorize({ date: '2026-11-01', amountMinor, name, ...extra }).categoryId;
    expect(c('REWE Markt', -2345)).toBe('groceries');
    expect(c('Vermieter Schmidt', -78000, { reference: 'Miete November' })).toBe('housing');
    expect(c('Netflix.com', -1399)).toBe('subscriptions');
    expect(c('Deutsche Bahn', -4990)).toBe('transport');
    expect(c('Lieferando', -1840)).toBe('dining');
    expect(c('DHL Group', 243120, { reference: 'Gehalt' })).toBe('salary');
    expect(c('Finanzamt', 31000, { reference: 'Steuererstattung' })).toBe('refunds');
    expect(c('Empresa rara', -1000)).toBe('other_expense');
    expect(c('Persona', 5000)).toBe('other_income');
    expect(categorize({ date: '2026-11-01', amountMinor: -10000, name: 'Urlaub', kind: 'Space transfer' }).internal).toBe(true);
  });
});

let app: FastifyInstance;
let store: FileStore;
beforeAll(async () => {
  store = new FileStore({ file: null });
  app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), store);
});
afterAll(() => app.close());

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
async function login() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `imp${Date.now()}${Math.random()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Ana' } });
  return { authorization: `Bearer ${json(res).accessToken}` };
}
const preview = async (headers: Record<string, string>, kind: 'csv' | 'pdf', content: string) =>
  app.inject({ method: 'POST', url: '/api/import/preview', headers, payload: { kind, content } });

describe('importación de extractos (API)', () => {
  it('vista previa → importar → el segundo intento detecta duplicados', async () => {
    const h = await login();
    const p = await preview(h, 'csv', N26_EN);
    expect(p.statusCode).toBe(200);
    const body = json(p);
    expect(body.engine).toBe('offline');
    expect(body.rows).toHaveLength(8);
    const by = (note: string) => body.rows.find((r: any) => r.note.includes(note));
    expect(by('REWE').categoryId).toBe('groceries');
    expect(by('DHL').type).toBe('income');
    expect(by('Urlaub').skip).toBe('internal');
    expect(by('DE89')).toBeUndefined(); // el IBAN nunca llega a la nota
    expect(body.stats).toMatchObject({ total: 8, skipped: 1, from: '2026-11-02', to: '2026-11-12' });

    const keep = body.rows.filter((r: any) => !r.skip).map((r: any) => ({ date: r.date, categoryId: r.categoryId, amountMinor: r.amountMinor, note: r.note }));
    const commit = await app.inject({ method: 'POST', url: '/api/import/commit', headers: h, payload: { rows: keep } });
    expect(commit.statusCode).toBe(200);
    expect(json(commit)).toMatchObject({ created: 7, from: '2026-11-02', to: '2026-11-12', monthsCovered: 1 });
    // El perfil financiero sigue siendo interno: la respuesta no lo expone.
    expect(JSON.stringify(json(commit))).not.toMatch(/archetype|incomeCV|savingsRate/);

    const list = await app.inject({ method: 'GET', url: '/api/transactions?from=2026-11-01&to=2026-11-30&limit=100', headers: h });
    expect(json(list).items).toHaveLength(7);

    // Importar el mismo archivo otra vez: todo lo ya guardado sale marcado como duplicado.
    const again = json(await preview(h, 'csv', N26_EN));
    expect(again.rows.filter((r: any) => r.skip === 'duplicate')).toHaveLength(7);
    expect(again.rows.filter((r: any) => !r.skip)).toHaveLength(0);
  });

  it('lee un PDF de extracto con texto', async () => {
    const h = await login();
    const pdf = readFileSync(new URL('./fixtures/statement.pdf', import.meta.url)).toString('base64');
    const p = await preview(h, 'pdf', pdf);
    expect(p.statusCode).toBe(200);
    const rows = json(p).rows as any[];
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.note.includes('Gehalt'))).toMatchObject({ type: 'income', categoryId: 'salary', amountMinor: 243120, date: '2026-11-05' });
    expect(rows.find((r) => r.note.includes('Miete'))).toMatchObject({ categoryId: 'housing', amountMinor: 78000 });
    expect(rows.find((r) => r.note.includes('Unbekannte'))).toMatchObject({ categoryId: 'other_expense', confidence: 'low' });
  });

  it('lee con OCR un PDF que sólo tiene imágenes y reconoce inversiones, préstamos y operadoras', async () => {
    const { ocrAvailable } = await import('../src/modules/import/ocr.js');
    if (!(await ocrAvailable())) return; // sin Tesseract en esta máquina no hay nada que probar
    const h = await login();
    const pdf = readFileSync(new URL('./fixtures/extracto-imagen.pdf', import.meta.url)).toString('base64');
    const p = await preview(h, 'pdf', pdf);
    expect(p.statusCode).toBe(200);
    const body = json(p);
    const rows = body.rows as any[];
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.note.includes('VODAFONE'))).toMatchObject({ categoryId: 'utilities', amountMinor: 703, date: '2026-06-13' });
    expect(rows.find((r) => r.note.includes('TRADE REPUBLIC'))).toMatchObject({ categoryId: 'investing', amountMinor: 5000 });
    expect(rows.find((r) => r.note.includes('PRES.'))).toMatchObject({ categoryId: 'debt', amountMinor: 3821 });
    expect(rows.find((r) => r.note.includes('TRANSFER'))).toMatchObject({ type: 'income', amountMinor: 30000 });
    expect(body.warnings.join(' ')).toMatch(/OCR/);
  });

  it('rechaza archivos que no son lo que dicen y datos inválidos', async () => {
    const h = await login();
    expect((await preview(h, 'pdf', Buffer.from('esto no es un pdf, ni de lejos'.repeat(10)).toString('base64'))).statusCode).toBe(400);
    expect((await preview(h, 'csv', 'columna1,columna2\n1,2\n3,4')).statusCode).toBe(422);
    const bad = await app.inject({ method: 'POST', url: '/api/import/commit', headers: h, payload: { rows: [{ date: '2026-11-02', categoryId: 'nope', amountMinor: 100 }] } });
    expect(bad.statusCode).toBe(400);
    const future = await app.inject({ method: 'POST', url: '/api/import/commit', headers: h, payload: { rows: [{ date: '2099-01-01', categoryId: 'groceries', amountMinor: 100 }] } });
    expect(future.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/import/preview', payload: { kind: 'csv', content: N26_EN } })).statusCode).toBe(401);
  });
});

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { _resetCapture } from '../src/modules/capture/service.js';
import { parseAmountMinor, parseNotification } from '../src/modules/capture/parse.js';
import { hashToken, newToken, tokenMatches } from '../src/modules/capture/token.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;

describe('lectura de notificaciones de pago', () => {
  it('importes en los formatos de cada país', () => {
    expect(parseAmountMinor('12,5')).toBe(1250);
    expect(parseAmountMinor('1.234,56')).toBe(123456);
    expect(parseAmountMinor('1,234.56')).toBe(123456);
    expect(parseAmountMinor('1.234')).toBe(123400);
    expect(parseAmountMinor('0')).toBeNull();
    expect(parseAmountMinor('abc')).toBeNull();
  });

  const cases: [string, { title?: string; text: string; app?: string }, { type: string; amountMinor: number; merchant: string }][] = [
    ['alemán, banco móvil', { text: 'Du hast 12,50 € bei REWE ausgegeben' }, { type: 'expense', amountMinor: 1250, merchant: 'REWE' }],
    ['alemán, Sparkasse', { title: 'Umsatz', text: 'Kartenzahlung -23,40 EUR DM Drogeriemarkt am 25.11.' }, { type: 'expense', amountMinor: 2340, merchant: 'DM Drogeriemarkt' }],
    ['alemán, ingreso', { title: 'Zahlung', text: 'Du hast 1.234,56 € von Max Mustermann erhalten' }, { type: 'income', amountMinor: 123456, merchant: 'Max Mustermann' }],
    ['alemán, devolución', { title: 'Rückerstattung', text: 'Du hast 19,99 € von Amazon zurückerhalten (Erstattung)' }, { type: 'income', amountMinor: 1999, merchant: 'Amazon' }],
    ['español', { text: 'Compra de 45,00 € en Mercadona con tu tarjeta ••4455' }, { type: 'expense', amountMinor: 4500, merchant: 'Mercadona' }],
    ['español, nómina y saldo', { title: 'Nómina', text: 'Abono nómina 1.850,45 €. Saldo disponible: 2.340,10 €' }, { type: 'income', amountMinor: 185045, merchant: 'Nómina' }],
    ['inglés', { text: 'You paid €4.20 to Starbucks' }, { type: 'expense', amountMinor: 420, merchant: 'Starbucks' }],
    ['italiano', { text: 'Pagamento di 32,10 € presso Esselunga con carta ••9988' }, { type: 'expense', amountMinor: 3210, merchant: 'Esselunga' }],
    ['italiano, «a»', { title: 'Pagamento', text: 'Hai pagato 2,50 € a Caffè Roma' }, { type: 'expense', amountMinor: 250, merchant: 'Caffè Roma' }],
    ['sin moneda pero con verbo', { text: 'Spent 7,80 at Albert Heijn' }, { type: 'expense', amountMinor: 780, merchant: 'Albert Heijn' }],
    ['Google Wallet (título = comercio)', { title: 'REWE', text: '12,50 € con Visa ••1234', app: 'com.google.android.apps.walletnfcrel' }, { type: 'expense', amountMinor: 1250, merchant: 'REWE' }],
    ['el saldo no es el pago', { text: 'Du hast 3,50 € bei Bäckerei Müller bezahlt. Verfügbar: 450,00 €' }, { type: 'expense', amountMinor: 350, merchant: 'Bäckerei Müller' }],
  ];
  it.each(cases)('%s', (_n, inp, want) => {
    expect(parseNotification(inp)).toMatchObject(want);
  });

  it('ignora códigos, saldos y publicidad', () => {
    expect(parseNotification({ text: 'Sicherheitscode 123456 für deine Zahlung von 50,00 €' })).toBe('no_cue');
    expect(typeof parseNotification({ title: 'Dein Kontostand', text: 'Dein Kontostand beträgt 1.234,00 €' })).toBe('string');
    expect(parseNotification({ title: 'Angebot', text: 'Spare jetzt 20 € bei deinem nächsten Einkauf!' })).toBe('no_cue');
    expect(parseNotification({ text: 'Tu cita es mañana' })).toBe('no_amount');
  });
});

describe('token', () => {
  it('se guarda solo el hash y se compara en tiempo constante', () => {
    const t = newToken();
    expect(t.token.startsWith('ecp_')).toBe(true);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).not.toContain(t.token);
    expect(tokenMatches(t.hash, t.token)).toBe(true);
    expect(tokenMatches(t.hash, t.token + 'x')).toBe(false);
    expect(tokenMatches(undefined, t.token)).toBe(false);
    expect(tokenMatches(t.hash, 'ecp_')).toBe(false);
  });
});

let app: FastifyInstance;
let store: FileStore;
beforeAll(async () => {
  store = new FileStore({ file: null });
  app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), store);
});
afterAll(() => app.close());
beforeEach(() => _resetCapture());

async function login() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `cap${Date.now()}${Math.random()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Ana' } });
  return { authorization: `Bearer ${json(res).accessToken}` };
}
async function setup(mode?: 'smart' | 'review' | 'auto') {
  const h = await login();
  const token = json(await app.inject({ method: 'POST', url: '/api/capture/token', headers: h })).token as string;
  if (mode) await app.inject({ method: 'PUT', url: '/api/capture/settings', headers: h, payload: { mode } });
  return { h, token };
}
const send = (token: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/capture/in', headers: { authorization: `Bearer ${token}` }, payload });
const info = async (h: Record<string, string>) => json(await app.inject({ method: 'GET', url: '/api/capture', headers: h }));
const txs = async (h: Record<string, string>) => json(await app.inject({ method: 'GET', url: '/api/transactions', headers: h })).items as any[] ?? [];

describe('token personal y endpoint público', () => {
  it('el token se enseña una vez, en la base solo queda su hash y sirve para añadir', async () => {
    const { h, token } = await setup();
    expect(token).toMatch(/^ecp_/);
    const i = await info(h);
    expect(i.enabled).toBe(true);
    expect(i.tokenHint).toBe(token.slice(-4));
    expect(JSON.stringify(i)).not.toContain(token);
    const stored = (await store.users.all()).find((u) => u.capture?.tokenHint === token.slice(-4))!;
    expect(JSON.stringify(stored)).not.toContain(token);
    const r = await send(token, { source: 'notification', text: 'Du hast 12,50 € bei REWE ausgegeben' });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toEqual({ ok: true, status: 'added' }); // sin ningún dato de vuelta
  });

  it('rechaza tokens falsos, vacíos o de otro formato, y regenerar invalida el anterior', async () => {
    const { h, token } = await setup();
    expect((await send('ecp_' + 'a'.repeat(43), { text: 'x' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/capture/in', payload: { text: 'Du hast 1 € bei A ausgegeben' } })).statusCode).toBe(401);
    expect((await send('not-a-token', { text: 'x' })).statusCode).toBe(401);
    const second = json(await app.inject({ method: 'POST', url: '/api/capture/token', headers: h })).token as string;
    expect(second).not.toBe(token);
    expect((await send(token, { text: 'Du hast 12,50 € bei REWE ausgegeben' })).statusCode).toBe(401);
    expect((await send(second, { text: 'Du hast 12,50 € bei REWE ausgegeben' })).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: '/api/capture/token', headers: h });
    expect((await send(second, { text: 'Du hast 1,50 € bei REWE ausgegeben' })).statusCode).toBe(401);
    expect((await info(h)).enabled).toBe(false);
  });

  it('el token también puede ir en el cuerpo (Atajos) y la gestión exige sesión', async () => {
    const { token } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/capture/in', payload: { token, source: 'wallet', merchant: 'Lidl', amount: '8,99 €' } });
    expect(json(r).status).toBe('added');
    expect((await app.inject({ method: 'GET', url: '/api/capture' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/capture/token' })).statusCode).toBe(401);
  });
});

describe('modos', () => {
  it('inteligente: añade lo que reconoce y deja pendiente lo dudoso', async () => {
    const { h, token } = await setup();
    expect(json(await send(token, { text: 'Du hast 12,50 € bei REWE ausgegeben' })).status).toBe('added');
    expect(json(await send(token, { text: 'Du hast 40,00 € bei Xyqor Holding ausgegeben' })).status).toBe('pending');
    const i = await info(h);
    expect(i.items).toHaveLength(1);
    expect(i.items[0]).toMatchObject({ merchant: 'Xyqor Holding', amountMinor: 4000, type: 'expense', categoryId: 'other_expense' });
    const list = await txs(h);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ note: 'REWE', categoryId: 'groceries', amountMinor: 1250, source: 'capture' });
  });

  it('revisar todo y automático', async () => {
    const a = await setup('review');
    expect(json(await send(a.token, { text: 'Du hast 12,50 € bei REWE ausgegeben' })).status).toBe('pending');
    const b = await setup('auto');
    expect(json(await send(b.token, { text: 'Du hast 40,00 € bei Xyqor Holding ausgegeben' })).status).toBe('added');
    expect(await txs(b.h)).toHaveLength(1);
  });

  it('otra moneda siempre queda pendiente y pide el importe en la tuya al añadirlo', async () => {
    const { h, token } = await setup('auto');
    expect(json(await send(token, { text: 'You paid $20.00 to Uber' })).status).toBe('pending');
    const item = (await info(h)).items[0];
    expect(item).toMatchObject({ foreign: true, currency: 'USD', amountMinor: 2000 });
    expect((await app.inject({ method: 'POST', url: `/api/capture/items/${item.id}/accept`, headers: h, payload: {} })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/api/capture/items/${item.id}/accept`, headers: h, payload: { amountMinor: 1850 } });
    expect(json(ok).transaction).toMatchObject({ amountMinor: 1850, currency: 'EUR', source: 'capture' });
  });

  it('un reembolso es un ingreso', async () => {
    const { h, token } = await setup('review');
    await send(token, { source: 'wallet', merchant: 'Zalando', amount: -45 });
    expect((await info(h)).items[0]).toMatchObject({ type: 'income', amountMinor: 4500 });
  });
});

describe('duplicados', () => {
  it('el mismo aviso dos veces, o el mismo id del móvil, no se duplica', async () => {
    const { h, token } = await setup();
    const p = { text: 'Du hast 12,50 € bei REWE ausgegeben' };
    expect(json(await send(token, p)).status).toBe('added');
    expect(json(await send(token, p)).status).toBe('duplicate');
    expect(json(await send(token, { source: 'wallet', merchant: 'Qwertz Brandl', amount: 3, id: 'abc-1' })).status).toBe('pending');
    expect(json(await send(token, { source: 'wallet', merchant: 'Qwertz Brandl', amount: 3, id: 'abc-1' })).status).toBe('duplicate');
    expect((await info(h)).items).toHaveLength(1);
    expect(await txs(h)).toHaveLength(1);
  });

  it('no repite lo que la persona ya apuntó a mano ese día', async () => {
    const { h, token } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({ method: 'POST', url: '/api/transactions', headers: h, payload: { type: 'expense', amountMinor: 1250, categoryId: 'groceries', date: today, note: 'REWE' } });
    expect(json(await send(token, { text: 'Du hast 12,50 € bei REWE ausgegeben' })).status).toBe('duplicate');
  });
});

describe('bandeja de pendientes', () => {
  it('añadir con otra categoría, descartar y añadir todo', async () => {
    const { h, token } = await setup('review');
    for (const [m, a] of [['Alfa', 1], ['Beta', 2], ['Gamma', 3], ['Delta', 4]] as const) await send(token, { source: 'wallet', merchant: m, amount: a });
    let items = (await info(h)).items as any[];
    expect(items).toHaveLength(4);
    const a = await app.inject({ method: 'POST', url: `/api/capture/items/${items.find((i) => i.merchant === 'Alfa').id}/accept`, headers: h, payload: { categoryId: 'dining', merchant: 'Alfa Bar' } });
    expect(json(a).transaction).toMatchObject({ categoryId: 'dining', note: 'Alfa Bar', amountMinor: 100 });
    expect((await app.inject({ method: 'POST', url: `/api/capture/items/${items.find((i) => i.merchant === 'Beta').id}/accept`, headers: h, payload: { categoryId: 'salary' } })).statusCode).toBe(400);
    await app.inject({ method: 'DELETE', url: `/api/capture/items/${items.find((i) => i.merchant === 'Gamma').id}`, headers: h });
    const all = json(await app.inject({ method: 'POST', url: '/api/capture/items/accept-all', headers: h }));
    expect(all).toMatchObject({ added: 2, left: 0 });
    items = (await info(h)).items;
    expect(items).toHaveLength(0);
    expect((await txs(h)).map((t) => t.note).sort()).toEqual(['Alfa Bar', 'Beta', 'Delta']);
  });

  it('cada cuenta ve solo lo suyo', async () => {
    const a = await setup('review');
    const b = await setup('review');
    await send(a.token, { source: 'wallet', merchant: 'Solo A', amount: 5 });
    expect((await info(b.h)).items).toHaveLength(0);
    const id = (await info(a.h)).items[0].id;
    expect((await app.inject({ method: 'POST', url: `/api/capture/items/${id}/accept`, headers: b.h, payload: {} })).statusCode).toBe(404);
  });

  it('el aviso de prueba sale pendiente y al «añadirlo» no crea ningún movimiento', async () => {
    const { h } = await setup();
    expect(json(await app.inject({ method: 'POST', url: '/api/capture/test', headers: h })).status).toBe('pending');
    const item = (await info(h)).items[0];
    expect(item.test).toBe(true);
    const r = json(await app.inject({ method: 'POST', url: `/api/capture/items/${item.id}/accept`, headers: h, payload: {} }));
    expect(r.transaction).toBeNull();
    expect(await txs(h)).toHaveLength(0);
  });
});

describe('avisos no reconocidos', () => {
  it('se guardan sin números largos, se pueden borrar y no crean nada', async () => {
    const { h, token } = await setup();
    expect(json(await send(token, { text: 'Tu código es 83749201 para el pago de 50,00 €', app: 'Banco' })).status).toBe('ignored');
    expect(json(await send(token, { text: 'Hola, tu cita es mañana' })).status).toBe('ignored');
    const i = await info(h);
    expect(i.ignored).toHaveLength(2);
    expect(JSON.stringify(i.ignored)).not.toContain('83749201');
    expect(await txs(h)).toHaveLength(0);
    await app.inject({ method: 'DELETE', url: '/api/capture/ignored/all', headers: h });
    expect((await info(h)).ignored).toHaveLength(0);
  });
});

describe('extracto del banco después de capturar', () => {
  it('lo ya capturado sale desmarcado como duplicado aunque la fecha difiera unos días', async () => {
    const { h, token } = await setup();
    await send(token, { text: 'Du hast 23,45 € bei REWE ausgegeben' });
    const today = new Date().toISOString().slice(0, 10);
    const d = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
    const csv = `"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"\n"${d(-2)}","${d(-2)}","REWE Markt","","Presentment","","Main Account","-23.45","","",""\n"${d(-2)}","${d(-2)}","Lidl","","Presentment","","Main Account","-10.00","","",""\n`;
    const res = json(await app.inject({ method: 'POST', url: '/api/import/preview', headers: h, payload: { kind: 'csv', content: csv } }));
    const rewe = res.rows.find((r: any) => /REWE/i.test(r.note));
    expect(rewe.skip).toBe('duplicate');
    expect(res.rows.find((r: any) => /Lidl/i.test(r.note)).skip).toBeUndefined();
    expect(res.warnings.join(' ')).toMatch(/móvil/);
  });
});

describe('avisos de banco con formatos mínimos', () => {
  it('un importe con signo y sin más palabras es un cargo o un abono', () => {
    expect(parseNotification({ app: 'de.number26.android', title: 'REWE', text: '−12,50 €' })).toMatchObject({ type: 'expense', amountMinor: 1250, merchant: 'REWE' });
    expect(parseNotification({ app: 'de.number26.android', title: 'Max Mustermann', text: '+50,00 €' })).toMatchObject({ type: 'income', amountMinor: 5000 });
  });
  it('«Zahlungsvorgang … über X €» se entiende como pago', () => {
    expect(parseNotification({ app: 'de.number26.android', title: 'N26', text: 'Dein Zahlungsvorgang bei REWE über 12,50 € wurde bearbeitet' })).toMatchObject({ type: 'expense', amountMinor: 1250, merchant: 'REWE' });
  });
  it('un importe sin signo ni palabra de pago sigue sin ser un pago', () => {
    expect(parseNotification({ app: 'de.number26.android', title: 'REWE', text: '€12.50' })).toBe('no_cue');
  });
});

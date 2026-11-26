import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const CUENTA_A = `Data;Descrizione;Importo
02/11/2026;ESSELUNGA MILANO;-42,17
03/11/2026;TRENITALIA WEB;-39,90
05/11/2026;RISTORANTE DA MARIO;-58,00
07/11/2026;AMAZON EU SARL;-27,99
08/11/2026;FARMACIA CENTRALE;-12,40
10/11/2026;NETFLIX.COM;-13,99
11/11/2026;Q8 EASY;-61,25
12/11/2026;Stipendio DHL;1800,00
`;
/** Mismo extracto, pero el banco anota cada operación con un día de diferencia. */
const CUENTA_A_DESPLAZADA = CUENTA_A.replace('02/11', '03/11').replace('05/11/2026;RISTORANTE', '06/11/2026;RISTORANTE').replace('07/11', '08/11');
const CUENTA_B = `Data;Descrizione;Importo
04/11/2026;CONAD CITY;-21,10
06/11/2026;ENEL ENERGIA;-74,30
09/11/2026;BAR CENTRALE;-3,20
13/11/2026;ZALANDO ITALIA;-89,90
14/11/2026;FARMACIA SALUTE;-9,80
16/11/2026;COOP ALLEANZA;-33,45
`;

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
});
afterAll(() => app.close());

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
async function login() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `cu${Date.now()}${Math.random()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Giulia' } });
  return { authorization: `Bearer ${json(res).accessToken}` };
}
const preview = async (h: Record<string, string>, content: string, extra: object = {}) =>
  json(await app.inject({ method: 'POST', url: '/api/import/preview', headers: h, payload: { kind: 'csv', content, ...extra } }));
async function importar(h: Record<string, string>, content: string, account?: string) {
  const p = await preview(h, content, { account });
  const rows = p.rows.filter((r: any) => !r.skip).map((r: any) => ({ date: r.date, categoryId: r.categoryId, amountMinor: r.amountMinor, note: r.note }));
  const res = await app.inject({ method: 'POST', url: '/api/import/commit', headers: h, payload: { rows, account } });
  expect(res.statusCode).toBe(200);
  return p;
}

describe('varias cuentas', () => {
  it('guarda la cuenta de cada movimiento, las lista y permite filtrar', async () => {
    const h = await login();
    await importar(h, CUENTA_A, 'Intesa');
    await importar(h, CUENTA_B, 'Nexi');
    const acc = json(await app.inject({ method: 'GET', url: '/api/import/accounts', headers: h })).accounts;
    expect(acc).toEqual([{ name: 'Intesa', count: 8 }, { name: 'Nexi', count: 6 }]);
    const nexi = json(await app.inject({ method: 'GET', url: '/api/transactions?account=Nexi&limit=100', headers: h })).items;
    expect(nexi).toHaveLength(6);
    expect(nexi.every((t: any) => t.account === 'Nexi')).toBe(true);
    // Los totales siguen sumando todas las cuentas.
    const all = json(await app.inject({ method: 'GET', url: '/api/transactions?limit=100', headers: h })).items;
    expect(all).toHaveLength(14);
  });

  it('dos cuentas distintas no se toman por duplicadas aunque coincida algún importe', async () => {
    const h = await login();
    await importar(h, CUENTA_A, 'Intesa');
    const otra = await preview(h, CUENTA_B + '12/11/2026;Q8 EASY;-61,25\n', { account: 'Nexi' });
    expect(otra.overlap).toBeUndefined();
    expect(otra.sameStatement).toBeUndefined();
    expect(otra.rows.filter((r: any) => r.skip === 'duplicate' || r.skip === 'other_account')).toHaveLength(0);
  });

  it('el mismo extracto en la misma cuenta se reconoce como ya importado', async () => {
    const h = await login();
    await importar(h, CUENTA_A, 'Intesa');
    const again = await preview(h, CUENTA_A, { account: 'Intesa' });
    expect(again.sameStatement).toMatchObject({ matched: 8, total: 8 });
    expect(again.rows.every((r: any) => r.skip === 'duplicate')).toBe(true);
  });

  it('detecta que es el mismo extracto subido por error con otro nombre de cuenta', async () => {
    const h = await login();
    await importar(h, CUENTA_A, 'Intesa');
    const mal = await preview(h, CUENTA_A, { account: 'Nexi' });
    expect(mal.overlap).toMatchObject({ account: 'Intesa', matched: 8, total: 8, ignored: false });
    expect(mal.rows.every((r: any) => r.skip === 'other_account')).toBe(true);
    // Y también si se deja la cuenta en blanco (la principal).
    const blanco = await preview(h, CUENTA_A);
    expect(blanco.overlap?.account).toBe('Intesa');
  });

  it('tolera que el banco ponga la fecha un día antes o después y que cambie el formato del texto', async () => {
    const h = await login();
    await importar(h, CUENTA_A, 'Intesa');
    const p = await preview(h, CUENTA_A_DESPLAZADA, { account: 'Otra' });
    expect(p.overlap).toMatchObject({ account: 'Intesa' });
    expect(p.overlap.matched).toBeGreaterThanOrEqual(7);
  });

  it('si la persona confirma que es otra cuenta, se importa todo', async () => {
    const h = await login();
    await importar(h, CUENTA_A, 'Intesa');
    const p = await preview(h, CUENTA_A, { account: 'Cuenta de mi pareja', assumeDifferentAccount: true });
    expect(p.overlap).toMatchObject({ account: 'Intesa', ignored: true });
    expect(p.rows.filter((r: any) => !r.skip)).toHaveLength(8);
  });

  it('un traspaso entre mis cuentas (importe igual y signo contrario) se desmarca si el texto lo dice', async () => {
    const h = await login();
    await importar(h, 'Data;Descrizione;Importo\n05/11/2026;Bonifico a conto risparmio;-500,00\n06/11/2026;ESSELUNGA;-20,00\n', 'Corriente');
    const p = await preview(h, 'Data;Descrizione;Importo\n05/11/2026;Bonifico da conto corrente;500,00\n07/11/2026;Stipendio;1500,00\n', { account: 'Ahorro' });
    const t = p.rows.find((r: any) => r.note.includes('Bonifico'));
    expect(t.skip).toBe('internal');
    expect(p.rows.find((r: any) => r.note.includes('Stipendio')).skip).toBeUndefined();
  });

  it('cambiar el nombre de la cuenta de un movimiento y borrarla', async () => {
    const h = await login();
    const created = json(await app.inject({ method: 'POST', url: '/api/transactions', headers: { ...h, 'x-requested-with': 'XMLHttpRequest' }, payload: { type: 'expense', amountMinor: 1000, categoryId: 'groceries', date: '2026-11-02', account: ' Nexi  ' } }));
    expect(created.account).toBe('Nexi');
    const patched = json(await app.inject({ method: 'PATCH', url: `/api/transactions/${created.id}`, headers: { ...h, 'x-requested-with': 'XMLHttpRequest' }, payload: { account: '' } }));
    expect(patched.account).toBeUndefined();
  });
});

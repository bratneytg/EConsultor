import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@econsultor/shared';
import { construirDatos } from '../src/panel/datos.js';
import { construirPsico } from '../src/panel/psico.js';
import { buildFinancialProfile } from '../src/modules/profile/engine.js';
import { FileStore } from '../src/store/file-store.js';
import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { UserRecord } from '../src/store/types.js';

const HOY = '2026-11-25';
let n = 0;
const tx = (date: string, type: 'income' | 'expense', categoryId: string, euros: number, note?: string): Transaction =>
  ({ id: `t${++n}`, date, type, categoryId, amountMinor: Math.round(euros * 100), currency: 'EUR', note, createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z` }) as Transaction;
const MESES = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const psico = (txs: Transaction[]) => construirPsico(txs, buildFinancialProfile(txs, HOY), HOY);
const rasgo = (p: ReturnType<typeof psico>, id: string) => p.rasgos!.find((r) => r.id === id)!;

describe('evaluación psico-económica', () => {
  it('con pocos datos no inventa nada', () => {
    const p = psico([tx('2026-11-01', 'income', 'salary', 2000), tx('2026-11-02', 'expense', 'housing', 800)]);
    expect(p.disponible).toBe(false);
    expect(p.motivo).toMatch(/15 movimientos/);
    expect(p.limites.length).toBeGreaterThan(2);
  });

  it('quien ahorra y gasta poco sale vigilante, tacaño, de largo plazo y con confianza razonable', () => {
    const txs: Transaction[] = [];
    for (const m of MESES) {
      txs.push(tx(`${m}-01`, 'income', 'salary', 3000), tx(`${m}-02`, 'expense', 'housing', 800));
      for (const d of ['05', '12', '19', '26']) txs.push(tx(`${m}-${d}`, 'expense', 'groceries', 60));
      txs.push(tx(`${m}-15`, 'expense', 'investing', 700, 'Trade Republic Sparplan'), tx(`${m}-10`, 'expense', 'dining', 25));
    }
    const p = psico(txs);
    expect(p.disponible).toBe(true);
    expect(p.restriccion).toBe(false);
    expect(p.guion!.id).toBe('vigilancia');
    expect(rasgo(p, 'tacano-derrochador').nivel).toBe('bajo');
    expect(rasgo(p, 'presente').nivel).toBe('bajo');
    expect(rasgo(p, 'autocontrol').puntos).toBeGreaterThan(rasgo(p, 'presente').puntos);
    expect(rasgo(p, 'guion-vigilancia').confianza).toBe('alta');
    expect(p.sinFiltro!.join(' ')).not.toMatch(/ahorro automático/);
  });

  it('quien gasta de más, en compras, restaurantes y apuestas, sale impulsivo y orientado al presente', () => {
    const txs: Transaction[] = [];
    for (const m of MESES) {
      txs.push(tx(`${m}-01`, 'income', 'salary', 2200), tx(`${m}-02`, 'expense', 'housing', 700));
      for (let d = 3; d <= 27; d += 2) txs.push(tx(`${m}-${String(d).padStart(2, '0')}`, 'expense', 'dining', 30), tx(`${m}-${String(d).padStart(2, '0')}`, 'expense', 'shopping', 90, 'Zalando'));
      txs.push(tx(`${m}-20`, 'expense', 'leisure', 60, 'Tipico Sportwetten'), tx(`${m}-21`, 'expense', 'leisure', 40, 'Lotto'));
    }
    const p = psico(txs);
    expect(p.disponible).toBe(true);
    expect(rasgo(p, 'tacano-derrochador').nivel).toBe('alto');
    expect(rasgo(p, 'presente').nivel).not.toBe('bajo');
    expect(rasgo(p, 'riesgo').puntos).toBeGreaterThan(35);
    expect(rasgo(p, 'riesgo').evidencia.join(' ')).toMatch(/Apuestas/);
    expect(p.revela!.join(' ')).toMatch(/apuestas/);
    expect(p.sinFiltro!.join(' ')).toMatch(/apuestas|fricción|ahorro automático/);
  });

  it('si casi todo el gasto es obligado avisa de que es restricción y baja la confianza', () => {
    const txs: Transaction[] = [];
    for (const m of MESES) {
      txs.push(tx(`${m}-01`, 'income', 'salary', 1500), tx(`${m}-02`, 'expense', 'housing', 800), tx(`${m}-05`, 'expense', 'utilities', 150));
      for (const d of ['07', '14', '21', '28']) txs.push(tx(`${m}-${d}`, 'expense', 'groceries', 125));
    }
    const p = psico(txs);
    expect(p.restriccion).toBe(true);
    expect(p.retrato![0]).toMatch(/restricción, no carácter/);
    expect(p.rasgos!.every((r) => r.confianza === 'baja')).toBe(true);
  });

  it('no incluye notas ni comercios sueltos', () => {
    const txs = MESES.flatMap((m) => [tx(`${m}-01`, 'income', 'salary', 2500), tx(`${m}-03`, 'expense', 'housing', 700), tx(`${m}-04`, 'expense', 'shopping', 80, 'Zalando Pedido 99887766'), tx(`${m}-08`, 'expense', 'groceries', 90), tx(`${m}-09`, 'expense', 'groceries', 70), tx(`${m}-12`, 'expense', 'dining', 30)]);
    expect(JSON.stringify(psico(txs))).not.toMatch(/Zalando|99887766/);
  });
});

describe('la evaluación sólo se ve en el panel y con su propio interruptor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'econ-psico-'));
  const archivoDatos = join(dir, 'store.json');
  const clave = randomBytes(32);
  const ahora = Date.parse('2026-11-25T12:00:00Z');
  const opciones = (verPerfiles: boolean, verPsico: boolean) => ({
    archivoDatos, claveDatos: clave, archivoHost: join(dir, 'no-host.json'), archivoHistorial: join(dir, 'no-hist.jsonl'),
    verImportes: false, verPerfiles, verPsico, puertoPanel: 8788, ahora,
  });
  beforeAll(async () => {
    const s = new FileStore({ file: archivoDatos, encryptionKey: clave });
    const u: UserRecord = {
      id: 'u1', email: 'u1@example.com', displayName: 'U1', plan: 'free', currency: 'EUR', timezone: 'Europe/Berlin', reminderEnabled: false, reminderTime: '21:00',
      mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    };
    await s.users.create(u);
    for (const m of MESES) {
      for (const [d, type, cat, e] of [['01', 'income', 'salary', 2500], ['02', 'expense', 'housing', 800], ['06', 'expense', 'groceries', 120], ['11', 'expense', 'dining', 60], ['18', 'expense', 'shopping', 90]] as const) {
        await s.transactions.create('u1', { id: `p${++n}`, date: `${m}-${d}`, type, categoryId: cat, amountMinor: e * 100, currency: 'EUR', createdAt: `${m}-${d}T10:00:00Z`, updatedAt: `${m}-${d}T10:00:00Z` } as never);
      }
    }
    await s.flush();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('apagada por defecto: ni en perfiles ni sin perfiles', () => {
    expect(JSON.stringify(construirDatos(opciones(true, false)).perfiles)).not.toContain('psico');
    expect(JSON.stringify(construirDatos(opciones(false, true)).perfiles)).toEqual('{"activo":false}');
  });

  it('con perfiles + psico aparece por persona', () => {
    const pf = construirDatos(opciones(true, true)).perfiles as any;
    expect(pf.perfiles[0].psico.disponible).toBe(true);
    expect(pf.perfiles[0].psico.rasgos.length).toBeGreaterThanOrEqual(8);
  });

  it('la API de la app nunca la expone', async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'p@example.com', password: 'Xk9-mango-lluvia-77', displayName: 'P' } });
    expect(reg.statusCode).toBe(201);
    const token = reg.json().accessToken as string;
    const h = { authorization: `Bearer ${token}` };
    for (const url of ['/api/me', '/api/analytics/overview?month=2026-11', '/api/advice']) {
      const r = await app.inject({ method: 'GET', url, headers: h });
      expect(r.body).not.toMatch(/psico|guion|vigilancia|Money Scripts|rasgos/i);
    }
    await app.close();
  });
});

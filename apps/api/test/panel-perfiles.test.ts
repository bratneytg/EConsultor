import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { construirDatos } from '../src/panel/datos.js';
import { FileStore } from '../src/store/file-store.js';
import type { UserRecord } from '../src/store/types.js';

const dir = mkdtempSync(join(tmpdir(), 'econ-perfiles-'));
const archivoDatos = join(dir, 'store.json');
const clave = randomBytes(32);
const ahora = Date.parse('2026-11-25T12:00:00Z');

const usuario = (id: string, email: string): UserRecord => ({
  id, email, displayName: id, plan: 'free', currency: 'EUR', timezone: 'Europe/Berlin', reminderEnabled: false, reminderTime: '21:00',
  mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
});
let n = 0;
const tx = (s: FileStore, u: string, date: string, type: 'income' | 'expense', categoryId: string, euros: number) =>
  s.transactions.create(u, { id: `t${++n}`, date, type, categoryId, amountMinor: euros * 100, currency: 'EUR', createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z` } as never);

const opciones = (verPerfiles: boolean) => ({
  archivoDatos, claveDatos: clave, archivoHost: join(dir, 'no-host.json'), archivoHistorial: join(dir, 'no-hist.jsonl'),
  verImportes: false, verPerfiles, puertoPanel: 8788, ahora,
});

beforeAll(async () => {
  const s = new FileStore({ file: archivoDatos, encryptionKey: clave });
  for (const [id, mail] of [['ahorra', 'ahorra@example.com'], ['gasta', 'gasta@example.com'], ['nuevo', 'nuevo@example.com']] as const) await s.users.create(usuario(id, mail));
  for (const mes of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    await tx(s, 'ahorra', `${mes}-01`, 'income', 'salary', 3000);
    await tx(s, 'ahorra', `${mes}-02`, 'expense', 'housing', 900);
    await tx(s, 'ahorra', `${mes}-10`, 'expense', 'groceries', 300);
    await tx(s, 'gasta', `${mes}-01`, 'income', 'salary', 1500);
    await tx(s, 'gasta', `${mes}-03`, 'expense', 'housing', 900);
    await tx(s, 'gasta', `${mes}-12`, 'expense', 'dining', 900);
  }
  await tx(s, 'nuevo', '2026-11-20', 'expense', 'groceries', 20);
  await s.reports.create({ id: 'r1aaaaaaaa', userId: 'ahorra', at: '2026-11-25T08:00:00Z', kind: 'bug', message: '<img src=x onerror=alert(1)> no guarda', page: '/ajustes', platform: 'android', appVersion: '1.0.0' });
  await s.reports.create({ id: 'r2bbbbbbbb', userId: 'gasta', at: '2026-11-20T08:00:00Z', kind: 'idea', message: 'Quiero metas de ahorro', page: '/consejos', platform: 'web' });
  await s.flush();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('perfiles en el panel', () => {
  it('están apagados por defecto y no se calcula nada', () => {
    const d = construirDatos(opciones(false));
    expect(d.perfiles).toEqual({ activo: false });
    expect(JSON.stringify(d)).not.toContain('arquetipo');
  });

  it('con la opción activa calcula perfil, riesgo y previsión por persona', () => {
    const d = construirDatos(opciones(true));
    const pf = d.perfiles as any;
    expect(pf.activo).toBe(true);
    const ahorra = pf.perfiles.find((p: any) => p.email === 'ahorra@example.com');
    const gasta = pf.perfiles.find((p: any) => p.email === 'gasta@example.com');
    expect(ahorra.arquetipo).toBe('saver');
    expect(ahorra.ahorroPct).toBe(60);
    expect(ahorra.categorias[0].nombre).toBe('Vivienda');
    expect(gasta.arquetipo).toBe('overspender');
    expect(gasta.ahorroPct).toBeLessThan(0);
    expect(gasta.riesgo).toBeGreaterThan(ahorra.riesgo);
    expect(gasta.lecturas.join(' ')).toContain('Gasta más de lo que ingresa');
    expect(ahorra.prevision.diasMes).toBe(30);
    expect(ahorra.meses12).toHaveLength(12);
    // De mayor a menor riesgo.
    expect(pf.perfiles[0].email).toBe('gasta@example.com');
    expect(pf.conjunto.conPerfil).toBe(2);
    expect(pf.conjunto.gastanDeMas).toBe(1);
  });

  it('quien tiene menos de 5 movimientos no recibe un perfil inventado', () => {
    const pf = construirDatos(opciones(true)).perfiles as any;
    expect(pf.perfiles.some((p: any) => p.email === 'nuevo@example.com')).toBe(false);
    expect(pf.sinDatos).toEqual([{ email: 'nuevo@example.com', movimientos: 1 }]);
  });

  it('no incluye notas ni movimientos individuales', () => {
    const texto = JSON.stringify(construirDatos(opciones(true)).perfiles);
    expect(texto).not.toMatch(/"note"|"nota"|"id":"t\d+"/);
  });
});

describe('reportes en el panel', () => {
  it('resume y lista los reportes, siempre disponibles', () => {
    const r = construirDatos(opciones(false)).reportes as any;
    expect(r.total).toBe(2);
    expect(r.ultimas24h).toBe(1);
    expect(r.porTipo).toEqual({ bug: 1, idea: 1, other: 0 });
    expect(r.lista[0]).toMatchObject({ email: 'ahorra@example.com', pantalla: '/ajustes', plataforma: 'android' });
    expect(r.porDia).toHaveLength(14);
  });

  it('un fallo reciente genera un aviso en el resumen', () => {
    const d = construirDatos(opciones(false));
    expect(d.resumen.alertas.some((a) => a.donde === 'Reportes')).toBe(true);
  });
});

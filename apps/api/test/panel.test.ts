import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearPanel } from '../src/panel.js';
import { construirDatos } from '../src/panel/datos.js';
import { FileStore } from '../src/store/file-store.js';
import type { UserRecord } from '../src/store/types.js';

const dir = mkdtempSync(join(tmpdir(), 'econ-panel-'));
const archivoDatos = join(dir, 'store.json');
const archivoHost = join(dir, 'host.json');
const archivoHistorial = join(dir, 'historial.jsonl');
const clave = randomBytes(32);
const CONTRASENA = 'una-contrasena-larga-de-prueba-123';
const ahora = Date.now();

const usuario = (id: string, email: string, extra: Partial<UserRecord> = {}): UserRecord => ({
  id,
  email,
  displayName: id,
  plan: 'free',
  currency: 'EUR',
  timezone: 'Europe/Berlin',
  reminderEnabled: true,
  reminderTime: '21:00',
  mfa: { enabled: false, recoveryHashes: [] },
  failedLogins: 0,
  createdAt: new Date(ahora - 3 * 86_400_000).toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra,
});

function host(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    t: Math.round(ahora / 1000),
    sistema: { nombre: 'bratney', so: 'Ubuntu 26.04', nucleo: '7.0', cpu_modelo: 'Intel', cpus: 2, encendido_s: 4000, reinicio_pendiente: false },
    cpu: { uso_pct: 5, carga: [0.1, 0.1, 0.1] },
    memoria: { total: 8e9, disponible: 6e9, usada_pct: 25, swap_total: 0, swap_usada: 0 },
    discos: [{ montaje: '/', total: 1e11, usado: 2e10, pct: 20 }],
    temperaturas: [{ nombre: 'cpu', c: 50 }],
    bateria: null,
    puertos: [{ direccion: '127.0.0.1', puerto: 8787, proceso: 'docker-proxy', abierto_a_la_red: false }],
    docker: { version: '28', contenedores: [{ nombre: 'econsultor-app-1', servicio: 'app', estado: 'running', salud: 'healthy', reinicios: 0, imagen: 'x', detalle: 'Up' }] },
    app: { ok: true, ms: 12 },
    tailscale: { estado: 'Running', nombre: 'bratney', dominio: 'bratney.ts.net', ips: [], pares: [], serve: [{ puerto: 443, ruta: '/', destino: 'http://127.0.0.1:8787', publico: true }] },
    lento: { t: 1, copias: { repo: '/b', restic: true, instantaneas: [{ id: 'abc', fecha: new Date(ahora - 3_600_000).toISOString(), equipo: 'x', rutas: [] }] }, apt: { pendientes: 0, seguridad: 0 } },
    puerto_app: 8787,
    puerto_panel: 8788,
    ...extra,
  };
}

const opciones = (verImportes = false) => ({
  archivoDatos,
  claveDatos: clave,
  archivoHost,
  archivoHistorial,
  verImportes,
  puertoPanel: 8788,
  ahora,
});

beforeAll(async () => {
  const s = new FileStore({ file: archivoDatos, encryptionKey: clave });
  await s.users.create(usuario('u1', 'maria.lopez@example.com', { plan: 'premium' }));
  await s.users.create(usuario('u2', 'pedro@example.com'));
  const iso = new Date(ahora - 3_600_000).toISOString();
  await s.transactions.create('u1', { id: 't1', date: '2026-11-10', type: 'expense', categoryId: 'food', amountMinor: 987654, currency: 'EUR', note: 'NOTA-PRIVADA', createdAt: iso, updatedAt: iso } as never);
  await s.audit.append({ id: 'a1', userId: 'u1', type: 'login', at: iso, ip: '203.0.113.7' });
  for (let i = 0; i < 5; i++) await s.audit.append({ id: `f${i}`, type: 'login_failed', at: iso, ip: '198.51.100.9', detail: 'unknown' });
  await s.flush();
  writeFileSync(archivoHost, JSON.stringify(host()));
  writeFileSync(archivoHistorial, `${JSON.stringify({ t: Math.round(ahora / 1000) - 60, cpu: 5, mem: 25, disco: 20, app: 1, ms: 12, db: 1000, rx: 100, tx: 100 })}\n${JSON.stringify({ t: Math.round(ahora / 1000), cpu: 7, mem: 26, disco: 20, app: 1, ms: 14, db: 1100, rx: 700, tx: 300 })}\n`);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('datos del panel', () => {
  it('enseña correos completos e IPs, pero no importes ni notas por defecto', () => {
    const d = construirDatos(opciones());
    const texto = JSON.stringify(d);
    expect(texto).toContain('maria.lopez@example.com');
    expect(texto).toContain('198.51.100.9');
    expect(texto).not.toContain('NOTA-PRIVADA');
    expect(texto).not.toContain('987654');
    expect(d.movimientos.ultimos).toBeUndefined();
  });

  it('con PANEL_VER_IMPORTES enseña los importes y las notas', () => {
    const texto = JSON.stringify(construirDatos(opciones(true)));
    expect(texto).toContain('NOTA-PRIVADA');
    expect(texto).toContain('987654');
  });

  it('con todo bien y 5 fallos desde una IP avisa solo de eso', () => {
    const d = construirDatos(opciones());
    expect(d.resumen.nivel).toBe('aviso');
    expect(d.resumen.alertas.map((a) => a.titulo)).toEqual(['5 intentos fallidos desde 198.51.100.9']);
    expect(d.resumen.frase).toBe('Hay 1 cosa que revisar.');
  });

  it('calcula la velocidad de red a partir de los contadores', () => {
    const d = construirDatos(opciones());
    const ultimo = d.historial.h24.at(-1) as { rx: number | null };
    expect(ultimo.rx === null || ultimo.rx > 0).toBe(true);
  });

  it('lanza una alerta roja si el panel está en Funnel', () => {
    writeFileSync(archivoHost, JSON.stringify(host({ tailscale: { estado: 'Running', nombre: 'b', dominio: 'b.ts.net', ips: [], pares: [], serve: [{ puerto: 8443, ruta: '/', destino: 'http://127.0.0.1:8788', publico: true }] } })));
    const d = construirDatos(opciones());
    expect(d.resumen.nivel).toBe('alerta');
    expect(d.resumen.alertas[0]?.titulo).toBe('EL PANEL ESTÁ ABIERTO A INTERNET');
    writeFileSync(archivoHost, JSON.stringify(host()));
  });

  it('avisa si la app no responde, si no hay copias recientes y si los datos del servidor están viejos', () => {
    writeFileSync(
      archivoHost,
      JSON.stringify(host({ t: Math.round(ahora / 1000) - 900, app: { ok: false, ms: 4000, error: 'timeout' }, lento: { t: 1, copias: { repo: '/b', restic: true, instantaneas: [{ id: 'a', fecha: new Date(ahora - 5 * 86_400_000).toISOString(), equipo: 'x', rutas: [] }] }, apt: { pendientes: 0, seguridad: 0 } } })),
    );
    const titulos = construirDatos(opciones()).resumen.alertas.map((a) => a.titulo);
    expect(titulos).toContain('La app no responde');
    expect(titulos.some((t) => t.startsWith('La última copia es de hace 5 días'))).toBe(true);
    expect(titulos).toContain('Los datos del servidor están desfasados');
    writeFileSync(archivoHost, JSON.stringify(host()));
  });

  it('con una clave equivocada lo dice sin romperse', () => {
    const otro = join(dir, 'otro.json');
    writeFileSync(otro, readFileSync(archivoDatos));
    const d = construirDatos({ ...opciones(), archivoDatos: otro, claveDatos: randomBytes(32) });
    expect(d.resumen.nivel).toBe('alerta');
    expect(d.resumen.alertas.some((a) => a.titulo === 'No se puede leer la base de datos')).toBe(true);
    expect(d.usuarios).toEqual([]);
  });

  it('sin archivos del servidor sigue funcionando y pide activar el recolector', () => {
    const d = construirDatos({ ...opciones(), archivoHost: join(dir, 'no-existe.json'), archivoHistorial: join(dir, 'no.jsonl') });
    expect(d.host).toBeNull();
    expect(d.resumen.alertas.some((a) => a.titulo === 'Sin datos del servidor')).toBe(true);
  });
});

describe('servidor del panel', () => {
  let base = '';
  let cerrar: () => void = () => undefined;

  beforeAll(async () => {
    const html = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
    const srv = crearPanel({ contrasena: CONTRASENA, puerto: 0, host: '127.0.0.1', cookieSegura: false, html, datos: opciones() });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    cerrar = () => srv.close();
  });
  afterAll(() => cerrar());

  const entrar = (clave: string, ip = '10.0.0.1') =>
    fetch(`${base}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ clave }) });

  it('la página lleva cabeceras estrictas y un nonce por petición', async () => {
    const a = await fetch(`${base}/`);
    const b = await fetch(`${base}/`);
    const csp = a.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect(a.headers.get('x-frame-options')).toBe('DENY');
    const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect((await a.text()).includes(`nonce="${nonce}"`)).toBe(true);
    expect(b.headers.get('content-security-policy')).not.toBe(csp);
  });

  it('los datos exigen sesión', async () => {
    expect((await fetch(`${base}/api/datos`)).status).toBe(401);
    expect((await fetch(`${base}/api/datos`, { headers: { Cookie: 'panel_sesion=inventada' } })).status).toBe(401);
  });

  it('con la contraseña correcta se entra y se leen los datos', async () => {
    const r = await entrar(CONTRASENA, '10.0.0.2');
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const d = await fetch(`${base}/api/datos`, { headers: { Cookie: cookie.split(';')[0]! } });
    expect(d.status).toBe(200);
    const json = (await d.json()) as { resumen: { frase: string } };
    expect(json.resumen.frase).toBeTruthy();
  });

  it('cerrar sesión invalida la cookie', async () => {
    const r = await entrar(CONTRASENA, '10.0.0.3');
    const c = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
    await fetch(`${base}/api/salir`, { method: 'POST', headers: { Cookie: c } });
    expect((await fetch(`${base}/api/datos`, { headers: { Cookie: c } })).status).toBe(401);
  });

  it('bloquea tras 5 contraseñas incorrectas desde la misma dirección', async () => {
    for (let i = 0; i < 5; i++) expect((await entrar('mal', '10.9.9.9')).status).toBe(401);
    expect((await entrar('mal', '10.9.9.9')).status).toBe(429);
    // Aunque acierte, sigue bloqueada esa dirección.
    expect((await entrar(CONTRASENA, '10.9.9.9')).status).toBe(429);
  });

  it('no admite métodos de escritura sobre los datos', async () => {
    expect((await fetch(`${base}/api/datos`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/api/datos`, { method: 'DELETE' })).status).toBe(404);
  });
});

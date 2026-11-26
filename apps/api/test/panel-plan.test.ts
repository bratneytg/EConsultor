import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { crearPanel } from '../src/panel.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const TOKEN = 'a'.repeat(64);
const CONTRASENA = 'una-contrasena-larga-de-prueba-123';
const PASS = 'Xk9-mango-lluvia-77';

const crear = async (env: Record<string, string> = {}) => {
  const store = new FileStore({ file: null });
  const app = await buildApp(loadConfig({ NODE_ENV: 'test', ...env } as NodeJS.ProcessEnv), store);
  return { app, store };
};
const registrar = async (app: FastifyInstance) => {
  const email = `pl${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'Pía' } });
  return { email, h: { authorization: `Bearer ${(r.json() as { accessToken: string }).accessToken}` } };
};
const plan = async (app: FastifyInstance, h: Record<string, string>) => ((await app.inject({ method: 'GET', url: '/api/me', headers: h })).json() as { plan: string }).plan;
const admin = (app: FastifyInstance, body: object, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: '/api/admin/plan', headers: token ? { 'x-admin-token': token } : {}, payload: body });

describe('ruta interna de la app para cambiar el plan', () => {
  let app: FastifyInstance;
  beforeAll(async () => { ({ app } = await crear({ ADMIN_TOKEN: TOKEN, PREMIUM_FOR_ALL: 'true' })); });
  afterAll(() => app.close());

  it('exige la clave', async () => {
    const { email } = await registrar(app);
    expect((await admin(app, { email, plan: 'free' }, null)).statusCode).toBe(401);
    expect((await admin(app, { email, plan: 'free' }, 'b'.repeat(64))).statusCode).toBe(401);
  });

  it('valida los datos y la cuenta', async () => {
    expect((await admin(app, { email: 'nadie@example.com', plan: 'free' })).statusCode).toBe(404);
    const { email } = await registrar(app);
    expect((await admin(app, { email, plan: 'vip' })).statusCode).toBe(400);
  });

  it('con Premium para todas, se puede dejar una cuenta en Gratuita y volver a automático', async () => {
    const { email, h } = await registrar(app);
    expect(await plan(app, h)).toBe('premium'); // PREMIUM_FOR_ALL
    const r1 = await admin(app, { email, plan: 'free' });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ plan: 'free', ajuste: 'free' });
    expect(await plan(app, h)).toBe('free');
    const consejos = (await app.inject({ method: 'GET', url: '/api/advice', headers: h })).json() as { plan: string };
    expect(consejos.plan).toBe('free');
    await admin(app, { email: email.toUpperCase(), plan: 'premium' }); // el correo no distingue mayúsculas
    expect(await plan(app, h)).toBe('premium');
    const r3 = await admin(app, { email, plan: 'auto' });
    expect(r3.json()).toMatchObject({ plan: 'premium', ajuste: null });
    expect(await plan(app, h)).toBe('premium');
  });

  it('deja constancia en el registro de seguridad', async () => {
    const { email } = await registrar(app);
    await admin(app, { email, plan: 'free' });
    const u = (await app.store.users.byEmail(email))!;
    const eventos = await app.store.audit.recent(u.id, 20);
    expect(eventos.some((e) => e.type === 'plan_changed' && e.detail?.includes('free'))).toBe(true);
  });
});

describe('sin ADMIN_TOKEN la ruta no existe', () => {
  it('404', async () => {
    const { app } = await crear();
    const { email } = await registrar(app);
    expect((await admin(app, { email, plan: 'free' })).statusCode).toBe(404);
    await app.close();
  });
});

describe('el panel cambia el plan a través de la app', () => {
  let app: FastifyInstance;
  let baseApp = '';
  let panel: ReturnType<typeof crearPanel>;
  let sinEnlace: ReturnType<typeof crearPanel>;
  let base = '';
  let baseSin = '';
  let cookie = '';
  let cookieSin = '';

  const opciones = (dir: string) => ({ archivoDatos: join(dir, 's.json'), archivoHost: join(dir, 'h.json'), archivoHistorial: join(dir, 'x.jsonl'), verImportes: false, puertoPanel: 0 });
  const entrar = async (b: string) => {
    const r = await fetch(`${b}/api/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.9' }, body: JSON.stringify({ clave: CONTRASENA }) });
    return (r.headers.get('set-cookie') ?? '').split(';')[0]!;
  };
  const cambiar = (b: string, c: string, body: object, cabeceras: Record<string, string> = { 'X-Panel': '1' }) =>
    fetch(`${b}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c, ...cabeceras }, body: JSON.stringify(body) });

  beforeAll(async () => {
    ({ app } = await crear({ ADMIN_TOKEN: TOKEN }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    baseApp = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const dir = mkdtempSync(join(tmpdir(), 'econ-panel-plan-'));
    const html = '<html></html>';
    panel = crearPanel({ contrasena: CONTRASENA, puerto: 0, host: '127.0.0.1', cookieSegura: false, html, datos: opciones(dir), app: { url: baseApp, token: TOKEN } });
    sinEnlace = crearPanel({ contrasena: CONTRASENA, puerto: 0, host: '127.0.0.1', cookieSegura: false, html, datos: opciones(dir) });
    await new Promise<void>((r) => panel.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => sinEnlace.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
    baseSin = `http://127.0.0.1:${(sinEnlace.address() as AddressInfo).port}`;
    cookie = await entrar(base);
    cookieSin = await entrar(baseSin);
  });
  afterAll(async () => { panel.close(); sinEnlace.close(); await app.close(); });

  it('pide sesión y la cabecera del propio panel', async () => {
    expect((await cambiar(base, '', { email: 'a@b.c', plan: 'free' })).status).toBe(401);
    expect((await cambiar(base, cookie, { email: 'a@b.c', plan: 'free' }, {})).status).toBe(400);
  });

  it('rechaza planes que no existen', async () => {
    expect((await cambiar(base, cookie, { email: 'a@b.c', plan: 'vip' })).status).toBe(400);
  });

  it('sin enlace con la app avisa y no hace nada', async () => {
    const r = await cambiar(baseSin, cookieSin, { email: 'a@b.c', plan: 'free' });
    expect(r.status).toBe(409);
  });

  it('cambia el plan de una cuenta de verdad', async () => {
    const { email, h } = await registrar(app);
    expect(await plan(app, h)).toBe('free');
    const r = await cambiar(base, cookie, { email, plan: 'premium' });
    expect(r.status).toBe(200);
    expect(await plan(app, h)).toBe('premium');
    expect((await cambiar(base, cookie, { email, plan: 'free' })).status).toBe(200);
    expect(await plan(app, h)).toBe('free');
  });

  it('si la cuenta no existe devuelve el error de la app', async () => {
    const r = await cambiar(base, cookie, { email: 'nadie@example.com', plan: 'premium' });
    expect(r.status).toBe(404);
  });

  it('si la clave del panel no coincide, no revela nada y avisa', async () => {
    const mal = crearPanel({ contrasena: CONTRASENA, puerto: 0, host: '127.0.0.1', cookieSegura: false, html: '<html></html>', datos: opciones(mkdtempSync(join(tmpdir(), 'econ-p-'))), app: { url: baseApp, token: 'c'.repeat(64) } });
    await new Promise<void>((r) => mal.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(mal.address() as AddressInfo).port}`;
    const c = await entrar(b);
    const r = await cambiar(b, c, { email: 'a@b.c', plan: 'free' });
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toContain('clave');
    mal.close();
  });
});

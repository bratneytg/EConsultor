import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const PASS = 'Xk9-mango-lluvia-77';
const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
const authed = (t: string) => ({ authorization: `Bearer ${t}` });
let n = 0;

async function registrar(app: FastifyInstance) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `func${++n}@example.com`, password: PASS, displayName: 'Ana' } });
  expect(res.statusCode).toBe(201);
  return { token: json(res).accessToken as string, user: json(res).user };
}

describe('Premium para todos (PREMIUM_FOR_ALL)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test', ALLOW_DEMO_DATA: 'true', PREMIUM_FOR_ALL: 'true' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
  });
  afterAll(() => app.close());

  it('una cuenta gratuita ve el plan premium y todos los consejos', async () => {
    const { token, user } = await registrar(app);
    expect(user.plan).toBe('premium');
    await app.inject({ method: 'POST', url: '/api/dev/demo-data', headers: authed(token) });
    const advice = json(await app.inject({ method: 'GET', url: '/api/advice', headers: authed(token) }));
    expect(advice.plan).toBe('premium');
    expect(advice.lockedCount).toBe(0);
  });
});

describe('reportar fallos (/api/feedback)', () => {
  let app: FastifyInstance;
  let store: FileStore;
  beforeAll(async () => {
    store = new FileStore({ file: null });
    app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), store);
  });
  afterAll(() => app.close());

  it('exige sesión', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/feedback', payload: { message: 'No me deja guardar' } });
    expect(r.statusCode).toBe(401);
  });

  it('guarda el reporte con contexto y sin permitir mensajes vacíos', async () => {
    const { token, user } = await registrar(app);
    const corto = await app.inject({ method: 'POST', url: '/api/feedback', headers: authed(token), payload: { message: 'ey' } });
    expect(corto.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/feedback', headers: { ...authed(token), 'user-agent': 'TestAgent/1.0' }, payload: { kind: 'bug', message: 'El botón de importar no hace nada', page: '/ajustes', platform: 'android', appVersion: '1.0.0' } });
    expect(ok.statusCode).toBe(201);
    const [r] = await store.reports.recent(5);
    expect(r).toMatchObject({ userId: user.id, kind: 'bug', page: '/ajustes', platform: 'android', userAgent: 'TestAgent/1.0' });
  });

  it('limita a 10 reportes por persona al día', async () => {
    const { token } = await registrar(app);
    let ultimo = 0;
    for (let i = 0; i < 11; i++) ultimo = (await app.inject({ method: 'POST', url: '/api/feedback', headers: authed(token), payload: { message: `Fallo número ${i} de prueba` } })).statusCode;
    expect(ultimo).toBe(409); // tope por persona: 10 al día
  });

  it('al eliminar la cuenta se borran sus reportes', async () => {
    const { token, user } = await registrar(app);
    await app.inject({ method: 'POST', url: '/api/feedback', headers: authed(token), payload: { message: 'Reporte que debe desaparecer' } });
    expect((await store.reports.recent(50)).some((r) => r.userId === user.id)).toBe(true);
    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: authed(token), payload: { confirmEmail: user.email, password: PASS } });
    expect(del.statusCode).toBe(200);
    expect((await store.reports.recent(50)).some((r) => r.userId === user.id)).toBe(false);
  });
});

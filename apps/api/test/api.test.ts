import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { open } from '../src/security/crypto.js';
import { totpAt } from '../src/security/totp.js';
import { FileStore } from '../src/store/file-store.js';

let app: FastifyInstance;
let store: FileStore;
let cfg: ReturnType<typeof loadConfig>;

beforeAll(async () => {
  cfg = loadConfig({ NODE_ENV: 'test', ALLOW_DEMO_DATA: 'true' } as NodeJS.ProcessEnv);
  store = new FileStore({ file: null });
  app = await buildApp(cfg, store);
});
afterAll(() => app.close());

const PASS = 'Xk9-mango-lluvia-77';
let n = 0;
const uniqueEmail = () => `user${++n}@example.com`;

const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
const cookieOf = (r: LightMyRequestResponse) => {
  const c = r.cookies.find((x) => x.name === 'econ_rt');
  return c ? `econ_rt=${c.value}` : '';
};

async function register(email = uniqueEmail()) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'Ana García' } });
  expect(res.statusCode).toBe(201);
  const body = json(res);
  return { email, token: body.accessToken as string, cookie: cookieOf(res), user: body.user };
}
const authed = (token: string) => ({ authorization: `Bearer ${token}` });

describe('autenticación', () => {
  it('registra, devuelve token y cookie httpOnly estricta', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: uniqueEmail(), password: PASS, displayName: 'Ana' } });
    expect(res.statusCode).toBe(201);
    const c = res.cookies.find((x) => x.name === 'econ_rt')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
    expect(json(res).user.passwordHash).toBeUndefined();
  });

  it('rechaza contraseñas débiles y emails duplicados', async () => {
    const weak = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: uniqueEmail(), password: 'password123', displayName: 'X' } });
    expect(weak.statusCode).toBe(400);
    const { email } = await register();
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'X' } });
    expect(dup.statusCode).toBe(409);
  });

  it('login incorrecto devuelve el mismo error exista o no el email', async () => {
    const { email } = await register();
    const a = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'incorrecta-123456' } });
    const b = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nadie@example.com', password: 'incorrecta-123456' } });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(json(a).message).toBe(json(b).message);
  });

  it('bloquea la cuenta tras 5 fallos', async () => {
    const { email } = await register();
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'incorrecta-123456' } });
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASS } });
    expect(locked.statusCode).toBe(429);
    expect(json(locked).error).toBe('account_locked');
  });

  it('exige token para rutas protegidas', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed('basura') })).statusCode).toBe(401);
  });
});

describe('rotación de refresh tokens', () => {
  it('rota, y la reutilización de un token viejo revoca toda la familia', async () => {
    const { cookie: c1 } = await register();
    const refresh = (cookie: string) => app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie, 'x-requested-with': 'econsultor' } });

    const r2 = await refresh(c1);
    expect(r2.statusCode).toBe(200);
    const c2 = cookieOf(r2);
    expect(c2).not.toBe(c1);

    // Pasada la ventana de gracia, reusar c1 es señal de robo.
    const session = await store.sessions.byTokenHash((await import('../src/security/crypto.js')).sha256(c1.split('=')[1]!));
    session!.usedAt = Date.now() - 60_000;
    expect((await refresh(c1)).statusCode).toBe(401);
    expect((await refresh(c2)).statusCode).toBe(401); // la familia entera está revocada
  });

  it('exige la cabecera anti-CSRF', async () => {
    const { cookie } = await register();
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('logout invalida el access token inmediatamente', async () => {
    const { token, cookie } = await register();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode).toBe(401);
  });
});

describe('segundo factor (TOTP)', () => {
  it('flujo completo: activar, login con 2FA, anti-replay y códigos de recuperación', async () => {
    const { email, token } = await register();

    const setup = json(await app.inject({ method: 'POST', url: '/api/auth/mfa/setup', headers: authed(token) }));
    expect(setup.otpauthUri).toContain('otpauth://totp/');
    const enable = await app.inject({ method: 'POST', url: '/api/auth/mfa/enable', headers: authed(token), payload: { code: totpAt(setup.secret, Date.now()) } });
    expect(enable.statusCode).toBe(200);
    const { recoveryCodes } = json(enable);
    expect(recoveryCodes).toHaveLength(10);

    // el secreto TOTP nunca se guarda en claro
    const stored = (await store.users.byEmail(email))!;
    expect(JSON.stringify(stored)).not.toContain(setup.secret);
    expect(open(cfg.dataKey, stored.mfa.secretSealed!).toString()).toBe(setup.secret);

    // login → ahora exige MFA y NO entrega sesión
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASS } });
    expect(json(login).mfaRequired).toBe(true);
    expect(json(login).accessToken).toBeUndefined();
    expect(cookieOf(login)).toBe('');
    const mfaToken = json(login).mfaToken;

    // código incorrecto
    expect((await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken, code: '000000' } })).statusCode).toBe(401);

    // el código usado al activar no puede reutilizarse (anti-replay); avanzamos al siguiente paso
    const future = totpAt(setup.secret, Date.now() + 30_000);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken, code: future } });
    expect(ok.statusCode).toBe(200);
    expect(json(ok).accessToken).toBeTruthy();
    const replay = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken, code: future } });
    expect(replay.statusCode).toBe(401);

    // código de recuperación: funciona una vez
    const login2 = json(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASS } }));
    const rec = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken: login2.mfaToken, recoveryCode: recoveryCodes[0] } });
    expect(rec.statusCode).toBe(200);
    const rec2 = await app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken: login2.mfaToken, recoveryCode: recoveryCodes[0] } });
    expect(rec2.statusCode).toBe(401);
  });

  it('un token MFA no sirve como access token', async () => {
    const { email, token } = await register();
    const setup = json(await app.inject({ method: 'POST', url: '/api/auth/mfa/setup', headers: authed(token) }));
    await app.inject({ method: 'POST', url: '/api/auth/mfa/enable', headers: authed(token), payload: { code: totpAt(setup.secret, Date.now()) } });
    const { mfaToken } = json(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASS } }));
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(mfaToken) })).statusCode).toBe(401);
  });
});

describe('movimientos y aislamiento de datos', () => {
  const tx = (over: object = {}) => ({ type: 'expense', amountMinor: 1250, categoryId: 'groceries', date: new Date().toISOString().slice(0, 10), note: 'Pan', ...over });

  it('CRUD completo', async () => {
    const { token } = await register();
    const created = await app.inject({ method: 'POST', url: '/api/transactions', headers: authed(token), payload: tx() });
    expect(created.statusCode).toBe(201);
    const id = json(created).id;
    const patched = await app.inject({ method: 'PATCH', url: `/api/transactions/${id}`, headers: authed(token), payload: { amountMinor: 999 } });
    expect(json(patched).amountMinor).toBe(999);
    const list = json(await app.inject({ method: 'GET', url: '/api/transactions', headers: authed(token) }));
    expect(list.items).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/transactions/${id}`, headers: authed(token) })).statusCode).toBe(204);
    expect(json(await app.inject({ method: 'GET', url: '/api/transactions', headers: authed(token) })).items).toHaveLength(0);
  });

  it('valida entradas (importes, categorías, fechas)', async () => {
    const { token } = await register();
    const post = (p: object) => app.inject({ method: 'POST', url: '/api/transactions', headers: authed(token), payload: p });
    expect((await post(tx({ amountMinor: -5 }))).statusCode).toBe(400);
    expect((await post(tx({ amountMinor: 12.5 }))).statusCode).toBe(400);
    expect((await post(tx({ categoryId: 'salary' }))).statusCode).toBe(400); // ingreso en gasto
    expect((await post(tx({ categoryId: 'inventada' }))).statusCode).toBe(400);
    expect((await post(tx({ date: '2026-02-31' }))).statusCode).toBe(400);
    expect((await post(tx({ date: '2099-01-01' }))).statusCode).toBe(400);
  });

  it('un usuario no puede ver, editar ni borrar movimientos de otro', async () => {
    const a = await register();
    const b = await register();
    const id = json(await app.inject({ method: 'POST', url: '/api/transactions', headers: authed(a.token), payload: tx() })).id;

    expect(json(await app.inject({ method: 'GET', url: '/api/transactions', headers: authed(b.token) })).items).toHaveLength(0);
    expect((await app.inject({ method: 'PATCH', url: `/api/transactions/${id}`, headers: authed(b.token), payload: { amountMinor: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/transactions/${id}`, headers: authed(b.token) })).statusCode).toBe(404);
    expect(json(await app.inject({ method: 'GET', url: '/api/transactions', headers: authed(a.token) })).items).toHaveLength(1);
  });
});

describe('analítica, perfil oculto y consejos', () => {
  it('con datos demo produce un resumen coherente', async () => {
    const { token } = await register();
    const seeded = await app.inject({ method: 'POST', url: '/api/dev/demo-data', headers: authed(token) });
    expect(seeded.statusCode).toBe(200);
    const o = json(await app.inject({ method: 'GET', url: '/api/analytics/overview', headers: authed(token) }));
    expect(o.totals.incomeMinor).toBeGreaterThan(0);
    expect(o.expenseByCategory.length).toBeGreaterThan(3);
    expect(o.monthly).toHaveLength(12);
    expect(o.heatmap).toHaveLength(119);
    expect(o.health.score).toBeGreaterThanOrEqual(0);
    expect(o.health.score).toBeLessThanOrEqual(100);
    const sumShares = o.expenseByCategory.reduce((s: number, c: any) => s + c.share, 0);
    expect(sumShares).toBeCloseTo(1, 5);
    expect(o.totals.netMinor).toBe(o.totals.incomeMinor - o.totals.expenseMinor);
  });

  it('el perfil financiero NO se expone en ninguna respuesta', async () => {
    const { token } = await register();
    await app.inject({ method: 'POST', url: '/api/dev/demo-data', headers: authed(token) });
    const bodies = await Promise.all(
      ['/api/me', '/api/analytics/overview', '/api/advice', '/api/transactions', '/api/me/export', '/api/me/security'].map(async (u) => (await app.inject({ method: 'GET', url: u, headers: authed(token) })).body),
    );
    for (const body of bodies) {
      for (const secretKey of ['riskScore', 'archetype', 'incomeCV', 'weekendBias', 'loggingConsistency', 'discretionaryShare', 'FinancialProfile']) {
        expect(body).not.toContain(secretKey);
      }
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('secretSealed');
    }
  });

  it('plan free limita los consejos; premium los desbloquea', async () => {
    const { token } = await register();
    await app.inject({ method: 'POST', url: '/api/dev/demo-data', headers: authed(token) });
    const free = json(await app.inject({ method: 'GET', url: '/api/advice', headers: authed(token) }));
    expect(free.items.length).toBeLessThanOrEqual(3);
    expect(free.lockedCount).toBeGreaterThan(0);
    await app.inject({ method: 'POST', url: '/api/dev/plan', headers: authed(token), payload: { plan: 'premium' } });
    const prem = json(await app.inject({ method: 'GET', url: '/api/advice', headers: authed(token) }));
    expect(prem.lockedCount).toBe(0);
    expect(prem.items.length).toBeGreaterThan(free.items.length);
    expect(prem.source).toBe('rules'); // sin ANTHROPIC_API_KEY cae a reglas
  });

  it('exporta y elimina la cuenta (RGPD)', async () => {
    const { token, email } = await register();
    await app.inject({ method: 'POST', url: '/api/transactions', headers: authed(token), payload: { type: 'income', amountMinor: 100000, categoryId: 'salary', date: new Date().toISOString().slice(0, 10) } });
    const exp = json(await app.inject({ method: 'GET', url: '/api/me/export', headers: authed(token) }));
    expect(exp.transactions).toHaveLength(1);
    const bad = await app.inject({ method: 'DELETE', url: '/api/me', headers: authed(token), payload: { confirmEmail: email, password: 'incorrecta-123456' } });
    expect(bad.statusCode).toBe(401);
    const del = await app.inject({ method: 'DELETE', url: '/api/me', headers: authed(token), payload: { confirmEmail: email, password: PASS } });
    expect(del.statusCode).toBe(200);
    expect(await store.users.byEmail(email)).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode).toBe(401);
  });
});

describe('cabeceras de seguridad', () => {
  it('aplica CSP, no-sniff y no cachea la API', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const { token } = await register();
    const api = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });
    expect(api.headers['cache-control']).toBe('no-store');
  });
});

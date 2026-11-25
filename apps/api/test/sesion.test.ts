import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

const PASS = 'Xk9-mango-lluvia-77';
let n = 0;
const uniqueEmail = () => `sesion${++n}@example.com`;
const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;
const cookieOf = (r: LightMyRequestResponse) => {
  const c = r.cookies.find((x) => x.name === 'econ_rt');
  return c ? `econ_rt=${c.value}` : '';
};
const authed = (token: string, active = false) => ({ authorization: `Bearer ${token}`, ...(active ? { 'x-user-active': '1' } : {}) });

describe('cierre de sesión por inactividad', () => {
  let app: FastifyInstance;
  let store: FileStore;

  beforeAll(async () => {
    store = new FileStore({ file: null });
    app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), store);
  });
  afterAll(() => app.close());

  async function registro() {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: uniqueEmail(), password: PASS, displayName: 'Ana' } });
    const body = json(res);
    const session = (await store.sessions.byTokenHash(createHash('sha256').update(cookieOf(res).slice('econ_rt='.length)).digest('hex')))!;
    return { token: body.accessToken as string, cookie: cookieOf(res), session, userId: body.user.id as string };
  }
  /** Simula que la persona lleva `min` minutos sin tocar la app. */
  const envejecer = async (s: { lastActiveAt?: number }, min: number) => {
    s.lastActiveAt = Date.now() - min * 60_000;
  };
  const refresh = (cookie: string, active = false) =>
    app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie, 'x-requested-with': 'econsultor', ...(active ? { 'x-user-active': '1' } : {}) } });

  it('una sesión recién abierta funciona; tras 11 min sin actividad se cierra', async () => {
    const { token, session } = await registro();
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode).toBe(200);
    await envejecer(session, 11);
    const r = await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) });
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toBe('idle_timeout');
    // y queda revocada: ya no vale ni siquiera «activa»
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token, true) })).statusCode).toBe(401);
  });

  it('las peticiones de la persona renuevan el plazo; las de segundo plano no', async () => {
    const { token, session } = await registro();
    await envejecer(session, 9);
    // segundo plano (sin cabecera): no renueva
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode).toBe(200);
    expect(Date.now() - session.lastActiveAt!).toBeGreaterThan(8.9 * 60_000);
    // actividad real: renueva
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token, true) })).statusCode).toBe(200);
    expect(Date.now() - session.lastActiveAt!).toBeLessThan(5_000);
  });

  it('el refresco silencioso no alarga la inactividad, pero abrir la app sí', async () => {
    const { cookie, session } = await registro();
    await envejecer(session, 6);
    const bg = await refresh(cookie); // refresco en segundo plano
    expect(bg.statusCode).toBe(200);
    const nuevo = (await store.sessions.byId(json(bg).user ? (await store.sessions.byTokenHash(createHash('sha256').update(cookieOf(bg).slice(8)).digest('hex')))!.id : ''))!;
    expect(Date.now() - nuevo.lastActiveAt!).toBeGreaterThan(5.9 * 60_000); // heredó la antigüedad
    const abrir = await refresh(cookieOf(bg), true); // la persona abre la app
    expect(abrir.statusCode).toBe(200);
    const abierta = (await store.sessions.byTokenHash(createHash('sha256').update(cookieOf(abrir).slice(8)).digest('hex')))!;
    expect(Date.now() - abierta.lastActiveAt!).toBeLessThan(5_000);
  });

  it('refrescar tras 11 min inactiva cierra la sesión (pide volver a entrar)', async () => {
    const { cookie, session } = await registro();
    await envejecer(session, 11);
    const r = await refresh(cookie, true);
    expect(r.statusCode).toBe(401);
    expect(json(r).error).toBe('idle_timeout');
    expect((await refresh(cookie)).statusCode).toBe(401);
  });

  it('«Mantener conectado» desactiva el cierre por inactividad', async () => {
    const { token, cookie, session } = await registro();
    const set = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: authed(token), payload: { keepSignedIn: true } });
    expect(set.statusCode).toBe(200);
    expect(json(set).keepSignedIn).toBe(true);
    await envejecer(session, 600);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).statusCode).toBe(200);
    expect((await refresh(cookie)).statusCode).toBe(200);
  });

  it('con IDLE_TIMEOUT_MIN=0 el servidor nunca cierra por inactividad', async () => {
    const st = new FileStore({ file: null });
    const a2 = await buildApp(loadConfig({ NODE_ENV: 'test', IDLE_TIMEOUT_MIN: '0' } as NodeJS.ProcessEnv), st);
    const res = await a2.inject({ method: 'POST', url: '/api/auth/register', payload: { email: uniqueEmail(), password: PASS, displayName: 'Ana' } });
    const body = json(res);
    const s = (await st.sessions.byTokenHash(createHash('sha256').update(cookieOf(res).slice(8)).digest('hex')))!;
    s.lastActiveAt = Date.now() - 3 * 3600_000;
    expect((await a2.inject({ method: 'GET', url: '/api/me', headers: authed(body.accessToken) })).statusCode).toBe(200);
    await a2.close();
  });
});

// ───────── Autenticador de software (hace de «huella» del móvil) ─────────
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

function cborBytes(b: Buffer): Buffer {
  const head = b.length < 24 ? Buffer.from([0x40 + b.length]) : b.length < 256 ? Buffer.from([0x58, b.length]) : Buffer.from([0x59, b.length >> 8, b.length & 255]);
  return Buffer.concat([head, b]);
}
const cborText = (s: string) => Buffer.concat([Buffer.from([0x60 + s.length]), Buffer.from(s)]);

class SoftAuthenticator {
  private priv: KeyObject;
  private pub: KeyObject;
  credId = randomBytes(32);
  counter = 0;
  constructor(private rpId = 'localhost', private origin = 'http://localhost:5173') {
    const kp = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.priv = kp.privateKey;
    this.pub = kp.publicKey;
  }
  private cose(): Buffer {
    const jwk = this.pub.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    return Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]), cborBytes(x), Buffer.from([0x22]), cborBytes(y)]);
  }
  private flags(uv: boolean, at: boolean) { return 0x01 | (uv ? 0x04 : 0) | (at ? 0x40 : 0); }
  private counterBuf() { const b = Buffer.alloc(4); b.writeUInt32BE(this.counter); return b; }

  create(options: any, { uv = true, origin = this.origin } = {}) {
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(this.credId.length);
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([this.flags(uv, true)]), this.counterBuf(), Buffer.alloc(16), credIdLen, this.credId, this.cose()]);
    const attObj = Buffer.concat([Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]), cborText('authData'), cborBytes(authData)]);
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attObj), transports: ['internal'] },
    };
  }

  get(options: any, userHandle: string, { uv = true, origin = this.origin, sign = true } = {}) {
    this.counter += 1;
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([this.flags(uv, false)]), this.counterBuf()]);
    const signer = createSign('SHA256');
    signer.update(Buffer.concat([authData, sha256(clientData)]));
    const sig = sign ? signer.sign(this.priv) : randomBytes(70);
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(sig), userHandle: b64u(Buffer.from(userHandle)) },
    };
  }
}

describe('inicio de sesión con huella (WebAuthn)', () => {
  let app: FastifyInstance;
  let store: FileStore;

  beforeAll(async () => {
    store = new FileStore({ file: null });
    app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), store);
  });
  afterAll(() => app.close());

  async function registro() {
    const email = uniqueEmail();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: PASS, displayName: 'Ana' } });
    const body = json(res);
    return { email, token: body.accessToken as string, userId: body.user.id as string };
  }
  async function altaLlave(token: string, dev = new SoftAuthenticator(), opts: Parameters<SoftAuthenticator['create']>[1] = {}) {
    const o = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options', headers: authed(token) });
    expect(o.statusCode).toBe(200);
    const opciones = json(o);
    expect(opciones.authenticatorSelection.userVerification).toBe('required');
    expect(opciones.authenticatorSelection.authenticatorAttachment).toBe('platform');
    const v = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/verify', headers: authed(token, true), payload: { response: dev.create(opciones, opts) } });
    return { dev, res: v };
  }
  async function entrar(dev: SoftAuthenticator, userId: string, opts: Parameters<SoftAuthenticator['get']>[2] = {}, desafio?: { challengeId: string; options: any }) {
    const o = desafio ?? json(await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options' }));
    return app.inject({ method: 'POST', url: '/api/auth/passkey/login/verify', payload: { challengeId: o.challengeId, response: dev.get(o.options, userId, opts) } });
  }

  it('registra una llave y la lista en el usuario sin exponer la clave', async () => {
    const { token, userId } = await registro();
    const { res } = await altaLlave(token);
    expect(res.statusCode).toBe(200);
    const me = json(await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) }));
    expect(me.passkeys).toHaveLength(1);
    expect(me.passkeys[0].publicKey).toBeUndefined();
    expect((await store.users.byId(userId))!.passkeys![0]!.counter).toBe(0);
  });

  it('ni /me, ni la exportación, ni el alta filtran la clave pública, el contador o el id de credencial', async () => {
    const { token } = await registro();
    const { res } = await altaLlave(token);
    const exp = await app.inject({ method: 'GET', url: '/api/me/export', headers: authed(token) });
    for (const texto of [exp.body, res.body, (await app.inject({ method: 'GET', url: '/api/me', headers: authed(token) })).body]) {
      expect(texto).not.toMatch(/publicKey|counter|credentialId|transports/);
    }
    expect(Object.keys(json(exp).user.passkeys[0]).sort()).toEqual(['createdAt', 'id', 'name']);
  });

  it('entra con la huella sin contraseña, y no pide el segundo factor', async () => {
    const { token, userId } = await registro();
    const { dev } = await altaLlave(token);
    const r = await entrar(dev, userId);
    expect(r.statusCode).toBe(200);
    const body = json(r);
    expect(body.mfaRequired).toBe(false);
    expect(body.user.id).toBe(userId);
    expect(cookieOf(r)).toContain('econ_rt=');
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(body.accessToken) })).statusCode).toBe(200);
    expect((await store.users.byId(userId))!.passkeys![0]!.counter).toBe(1);
  });

  it('rechaza reutilizar el mismo reto (un solo uso)', async () => {
    const { token, userId } = await registro();
    const { dev } = await altaLlave(token);
    const reto = json(await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options' })) as { challengeId: string; options: any };
    expect((await entrar(dev, userId, {}, reto)).statusCode).toBe(200);
    expect((await entrar(dev, userId, {}, reto)).statusCode).toBe(401);
  });

  it('rechaza firma falsa, origen ajeno y falta de verificación de usuario', async () => {
    const { token, userId } = await registro();
    const { dev } = await altaLlave(token);
    expect((await entrar(dev, userId, { sign: false })).statusCode).toBe(401);
    expect((await entrar(dev, userId, { origin: 'https://phishing.example' })).statusCode).toBe(401);
    expect((await entrar(dev, userId, { uv: false })).statusCode).toBe(401);
    expect((await entrar(dev, userId)).statusCode).toBe(200); // la buena sí
  });

  it('una llave de otra persona no sirve aunque se invente el userHandle', async () => {
    const a = await registro();
    const b = await registro();
    const { dev } = await altaLlave(a.token);
    expect((await entrar(dev, b.userId)).statusCode).toBe(401);
  });

  it('rechaza un alta sin verificación de usuario o desde otro origen', async () => {
    const { token } = await registro();
    expect((await altaLlave(token, new SoftAuthenticator(), { uv: false })).res.statusCode).toBe(400);
    expect((await altaLlave(token, new SoftAuthenticator(), { origin: 'https://otro.example' })).res.statusCode).toBe(400);
  });

  it('se puede quitar una llave; sin contraseña ni Google no se permite quitar la última', async () => {
    const { token, userId } = await registro();
    const { dev } = await altaLlave(token);
    const id = b64u(dev.credId);
    const del = await app.inject({ method: 'DELETE', url: `/api/auth/passkey/${id}`, headers: authed(token) });
    expect(del.statusCode).toBe(200);
    expect((await entrar(dev, userId)).statusCode).toBe(401);

    const u = (await store.users.byId(userId))!;
    const solo = await altaLlave(token);
    expect(solo.res.statusCode).toBe(200);
    u.passwordHash = undefined;
    await store.users.update(u);
    const del2 = await app.inject({ method: 'DELETE', url: `/api/auth/passkey/${b64u(solo.dev.credId)}`, headers: authed(token) });
    expect(del2.statusCode).toBe(400);
  });

  it('limita a 5 dispositivos por cuenta', async () => {
    const { token } = await registro();
    for (let i = 0; i < 5; i++) expect((await altaLlave(token)).res.statusCode).toBe(200);
    const o = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options', headers: authed(token) });
    expect(o.statusCode).toBe(400);
  });
});

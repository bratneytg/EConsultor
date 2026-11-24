import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { googleInput, loginInput, mfaVerifyInput, registerInput, type AuthResponse, type PublicUser } from '@econsultor/shared';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { dummyVerify, hashPassword, passwordProblem, verifyPassword } from '../security/password.js';
import { open, randomToken, seal, sha256 } from '../security/crypto.js';
import { ACCESS_TTL_S, signAccess, signMfa, verifyMfa } from '../security/tokens.js';
import { generateRecoveryCodes, generateSecret, otpauthUri, verifyTotp } from '../security/totp.js';
import type { SessionRecord, UserRecord } from '../store/types.js';

const COOKIE = 'econ_rt';
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const REUSE_GRACE_MS = 10_000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    plan: u.plan,
    currency: u.currency,
    timezone: u.timezone,
    reminderEnabled: u.reminderEnabled,
    reminderTime: u.reminderTime,
    uiMode: u.uiMode ?? 'simple',
    mfaEnabled: u.mfa.enabled,
    hasPassword: !!u.passwordHash,
    googleLinked: !!u.googleSub,
    createdAt: u.createdAt,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { cfg, store } = app;
  const strict = { config: { rateLimit: { max: cfg.authRateLimit, timeWindow: '1 minute' } } };

  const audit = (req: FastifyRequest, type: string, userId?: string, detail?: string) =>
    store.audit.append({ id: randomUUID(), userId, type, at: new Date().toISOString(), ip: req.ip, detail });

  const setRefreshCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      secure: cfg.isProd,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: REFRESH_TTL_MS / 1000,
    });
  const clearRefreshCookie = (reply: FastifyReply) => reply.clearCookie(COOKIE, { path: '/api/auth' });

  async function startSession(req: FastifyRequest, reply: FastifyReply, user: UserRecord, familyId: string = randomUUID()): Promise<string> {
    const refresh = randomToken(32);
    const session: SessionRecord = {
      id: randomUUID(),
      userId: user.id,
      familyId,
      tokenHash: sha256(refresh),
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + REFRESH_TTL_MS,
      userAgent: req.headers['user-agent']?.slice(0, 200),
    };
    await store.sessions.create(session);
    setRefreshCookie(reply, refresh);
    return signAccess(cfg.accessSecret, { sub: user.id, sid: session.id });
  }

  async function registerFailure(user: UserRecord): Promise<void> {
    user.failedLogins += 1;
    if (user.failedLogins >= MAX_FAILS) {
      user.lockedUntil = Date.now() + LOCK_MS;
      user.failedLogins = 0;
    }
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
  }

  const assertNotLocked = (user: UserRecord) => {
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      throw new AppError(429, 'account_locked', 'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.');
    }
  };

  async function complete(req: FastifyRequest, reply: FastifyReply, user: UserRecord, method: string): Promise<AuthResponse> {
    user.failedLogins = 0;
    user.lockedUntil = undefined;
    await store.users.update(user);
    const accessToken = await startSession(req, reply, user);
    await audit(req, 'login', user.id, method);
    return { mfaRequired: false, accessToken, user: toPublicUser(user) };
  }

  // ───────── Registro ─────────
  app.post('/register', strict, async (req, reply) => {
    const body = registerInput.parse(req.body);
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw badRequest(problem, 'weak_password');
    if (await store.users.byEmail(body.email)) throw conflict('Ya existe una cuenta con ese email', 'email_taken');

    const now = new Date().toISOString();
    const user: UserRecord = {
      id: randomUUID(),
      email: body.email,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      plan: 'free',
      currency: body.currency ?? 'EUR',
      timezone: body.timezone ?? 'Europe/Berlin',
      reminderEnabled: true,
      reminderTime: '21:00',
      uiMode: 'simple',
      mfa: { enabled: false, recoveryHashes: [] },
      failedLogins: 0,
      createdAt: now,
      updatedAt: now,
    };
    await store.users.create(user);
    await audit(req, 'register', user.id);
    return reply.status(201).send(await complete(req, reply, user, 'password'));
  });

  // ───────── Login (contraseña) ─────────
  app.post('/login', strict, async (req, reply) => {
    // Un cliente antiguo (PWA en caché) manda `email` en vez de `identifier`: se acepta igual.
    const raw = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const candidate = { identifier: raw.identifier ?? raw.email, password: raw.password };
    const parsed = loginInput.safeParse(candidate);
    if (!parsed.success) {
      // Solo formas, nunca el valor: sirve para diagnosticar «no me deja entrar» sin guardar credenciales.
      const id = typeof candidate.identifier === 'string' ? candidate.identifier : '';
      req.log.warn({ keys: Object.keys(raw), idLength: id.length, idHasAt: id.includes('@') }, 'login rechazado por formato');
      throw parsed.error;
    }
    const body = parsed.data;
    const user = await store.users.byEmail(body.identifier);
    if (!user || !user.passwordHash) {
      await dummyVerify(body.password); // iguala tiempos: no revela si el email existe
      await audit(req, 'login_failed', undefined, 'unknown');
      throw unauthorized('Usuario o contraseña incorrectos', 'invalid_credentials');
    }
    assertNotLocked(user);
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await registerFailure(user);
      await audit(req, 'login_failed', user.id);
      throw unauthorized('Usuario o contraseña incorrectos', 'invalid_credentials');
    }
    if (user.mfa.enabled) {
      return reply.send({ mfaRequired: true, mfaToken: await signMfa(cfg.accessSecret, user.id) } satisfies AuthResponse);
    }
    return reply.send(await complete(req, reply, user, 'password'));
  });

  // ───────── Segundo factor ─────────
  app.post('/mfa/verify', strict, async (req, reply) => {
    const body = mfaVerifyInput.parse(req.body);
    const userId = await verifyMfa(cfg.accessSecret, body.mfaToken);
    const user = userId ? await store.users.byId(userId) : undefined;
    if (!user || !user.mfa.enabled || !user.mfa.secretSealed) throw unauthorized('Verificación caducada, vuelve a iniciar sesión', 'mfa_expired');
    assertNotLocked(user);

    let ok = false;
    if (body.code) {
      const secret = open(cfg.dataKey, user.mfa.secretSealed).toString('utf8');
      const step = verifyTotp(secret, body.code, Date.now(), user.mfa.lastStep ?? -1);
      if (step !== null) {
        user.mfa.lastStep = step; // anti-replay
        ok = true;
      }
    } else if (body.recoveryCode) {
      const h = sha256(body.recoveryCode.toUpperCase().replace(/\s/g, ''));
      const idx = user.mfa.recoveryHashes.indexOf(h);
      if (idx >= 0) {
        user.mfa.recoveryHashes.splice(idx, 1); // un solo uso
        ok = true;
        await audit(req, 'recovery_code_used', user.id);
      }
    }
    if (!ok) {
      await registerFailure(user);
      await audit(req, 'mfa_failed', user.id);
      throw unauthorized('Código incorrecto', 'invalid_code');
    }
    return reply.send(await complete(req, reply, user, 'password+mfa'));
  });

  app.post('/mfa/setup', { preHandler: app.requireAuth }, async (req) => {
    const user = req.user;
    if (user.mfa.enabled) throw conflict('El segundo factor ya está activo', 'mfa_already_enabled');
    const secret = generateSecret();
    user.mfa.pendingSecretSealed = seal(cfg.dataKey, secret);
    await store.users.update(user);
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  });

  app.post('/mfa/enable', { preHandler: app.requireAuth, ...strict }, async (req) => {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const user = req.user;
    if (!user.mfa.pendingSecretSealed) throw badRequest('Primero inicia la configuración', 'mfa_not_started');
    const secret = open(cfg.dataKey, user.mfa.pendingSecretSealed).toString('utf8');
    const step = verifyTotp(secret, code, Date.now());
    if (step === null) throw badRequest('Código incorrecto', 'invalid_code');
    const recoveryCodes = generateRecoveryCodes();
    user.mfa = {
      enabled: true,
      secretSealed: user.mfa.pendingSecretSealed,
      lastStep: step,
      recoveryHashes: recoveryCodes.map((c) => sha256(c)),
    };
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    await audit(req, 'mfa_enabled', user.id);
    return { recoveryCodes }; // se muestran UNA sola vez
  });

  app.post('/mfa/disable', { preHandler: app.requireAuth, ...strict }, async (req) => {
    const body = z.object({ password: z.string().max(128).optional(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const user = req.user;
    if (!user.mfa.enabled || !user.mfa.secretSealed) throw badRequest('El segundo factor no está activo');
    if (user.passwordHash && !(body.password && (await verifyPassword(body.password, user.passwordHash)))) {
      throw unauthorized('Contraseña incorrecta', 'invalid_credentials');
    }
    const secret = open(cfg.dataKey, user.mfa.secretSealed).toString('utf8');
    if (verifyTotp(secret, body.code, Date.now(), user.mfa.lastStep ?? -1) === null) throw unauthorized('Código incorrecto', 'invalid_code');
    user.mfa = { enabled: false, recoveryHashes: [] };
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    await audit(req, 'mfa_disabled', user.id);
    return { ok: true };
  });

  // ───────── Google (OpenID Connect) ─────────
  // Requiere GOOGLE_CLIENT_ID. Se valida el ID token (firma, issuer, audience, expiración y email verificado).
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  app.post('/google', strict, async (req, reply) => {
    if (!cfg.googleClientId) throw new AppError(501, 'google_disabled', 'El acceso con Google no está configurado');
    const { idToken } = googleInput.parse(req.body);
    jwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(idToken, jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: cfg.googleClientId,
      }));
    } catch {
      throw unauthorized('Token de Google no válido', 'invalid_google_token');
    }
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    if (!claims.sub || !email || claims.email_verified !== true) throw unauthorized('Cuenta de Google sin email verificado', 'invalid_google_token');

    let user = await store.users.byGoogleSub(claims.sub);
    if (!user) {
      // Un email ya registrado con contraseña NO se enlaza automáticamente (evita toma de cuenta
      // por pre-registro). El usuario debe entrar con su contraseña y vincular Google desde ajustes.
      if (await store.users.byEmail(email)) throw conflict('Ya existe una cuenta con ese email. Inicia sesión con tu contraseña.', 'account_exists');
      const now = new Date().toISOString();
      user = {
        id: randomUUID(), email, googleSub: claims.sub,
        displayName: typeof claims.name === 'string' ? claims.name.slice(0, 60) : email.split('@')[0]!,
        plan: 'free', currency: 'EUR', timezone: 'Europe/Berlin', reminderEnabled: true, reminderTime: '21:00',
        mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: now, updatedAt: now,
      };
      await store.users.create(user);
      await audit(req, 'register', user.id, 'google');
    }
    return reply.send(await complete(req, reply, user, 'google'));
  });

  // ───────── Renovación con rotación y detección de reutilización ─────────
  // El refresco silencioso ocurre en cada carga de la app (varias pestañas, recargas): límite más holgado.
  const refreshLimit = { config: { rateLimit: { max: cfg.authRateLimit * 3, timeWindow: '1 minute' } } };
  app.post('/refresh', refreshLimit, async (req, reply) => {
    if (req.headers['x-requested-with'] !== 'econsultor') throw new AppError(403, 'csrf', 'Cabecera requerida ausente');
    const raw = req.cookies[COOKIE];
    if (!raw) throw unauthorized('Sin sesión', 'no_session');
    const session = await store.sessions.byTokenHash(sha256(raw));
    if (!session || session.revokedAt || session.expiresAt < Date.now()) {
      clearRefreshCookie(reply);
      throw unauthorized('Sesión caducada', 'no_session');
    }
    if (session.usedAt) {
      // Un refresh token ya rotado se ha vuelto a presentar → posible robo. Revocamos toda la familia.
      if (Date.now() - session.usedAt > REUSE_GRACE_MS) {
        await store.sessions.revokeFamily(session.familyId);
        await audit(req, 'refresh_reuse_detected', session.userId);
      }
      clearRefreshCookie(reply);
      throw unauthorized('Sesión no válida', 'no_session');
    }
    const user = await store.users.byId(session.userId);
    if (!user) throw unauthorized();
    session.usedAt = Date.now();
    await store.sessions.update(session);
    const accessToken = await startSession(req, reply, user, session.familyId);
    return reply.send({ accessToken, expiresIn: ACCESS_TTL_S, user: toPublicUser(user) } as const);
  });

  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[COOKIE];
    if (raw) {
      const s = await store.sessions.byTokenHash(sha256(raw));
      if (s) await store.sessions.revokeFamily(s.familyId);
    }
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });

  app.post('/logout-all', { preHandler: app.requireAuth }, async (req, reply) => {
    await store.sessions.revokeAllForUser(req.user.id);
    await audit(req, 'logout_all', req.user.id);
    clearRefreshCookie(reply);
    return reply.send({ ok: true });
  });
}

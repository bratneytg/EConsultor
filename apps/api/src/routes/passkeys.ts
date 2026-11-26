import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { AuthResponse } from '@econsultor/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { randomToken } from '../security/crypto.js';
import type { AppBiometricRecord, PasskeyRecord, UserRecord } from '../store/types.js';
import { tr } from '../lib/i18n.js';

export interface PasskeyDeps {
  complete: (req: FastifyRequest, reply: FastifyReply, user: UserRecord, method: string) => Promise<AuthResponse>;
  assertNotLocked: (user: UserRecord) => void;
  audit: (req: FastifyRequest, type: string, userId?: string, detail?: string) => Promise<void>;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PASSKEYS = 5;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const methodsLeft = (u: UserRecord): number => (u.passkeys?.length ?? 0) + (u.appBiometrics?.length ?? 0);

const b64u = {
  enc: (b: Uint8Array): string => Buffer.from(b).toString('base64url'),
  dec: (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'base64url')),
};

/** Nombre legible del dispositivo, a partir del user-agent (solo para que la persona reconozca la llave en su lista). */
export function deviceLabel(ua: string | undefined): string {
  const s = ua ?? '';
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad/i.test(s) ? 'iPhone/iPad' : /Windows/i.test(s) ? 'Windows' : /Mac OS X|Macintosh/i.test(s) ? 'Mac' : /Linux/i.test(s) ? 'Linux' : 'Dispositivo';
  const br = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

/**
 * Inicio de sesión con huella (WebAuthn / llaves de acceso).
 * El servidor solo guarda la clave pública; la huella nunca sale del dispositivo.
 * Una llave con verificación de usuario (huella, cara o PIN) ya son dos factores: no se pide el código TOTP.
 */
export async function passkeyRoutes(app: FastifyInstance, deps: PasskeyDeps): Promise<void> {
  const { cfg, store } = app;
  const { complete, assertNotLocked, audit } = deps;
  const rpID = new URL(cfg.publicOrigin).hostname;
  const auth = { preHandler: app.requireAuth };
  const strict = { config: { rateLimit: { max: cfg.authRateLimit, timeWindow: '1 minute' } } };

  // Retos de un solo uso en memoria (un único proceso). Caducan a los 5 min.
  const challenges = new Map<string, { challenge: string; userId?: string; exp: number }>();
  const put = (key: string, challenge: string, userId?: string) => {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
    challenges.set(key, { challenge, userId, exp: now + CHALLENGE_TTL_MS });
  };
  const take = (key: string) => {
    const v = challenges.get(key);
    challenges.delete(key);
    return v && v.exp > Date.now() ? v : undefined;
  };

  // ── Alta de una llave (con sesión iniciada) ──
  app.post('/register/options', { ...auth, ...strict }, async (req) => {
    const user = req.user;
    const existing = user.passkeys ?? [];
    if (existing.length >= MAX_PASSKEYS) throw badRequest(tr('Máximo {max} dispositivos. Elimina alguno primero.', { max: MAX_PASSKEYS }), 'too_many_passkeys');
    const options = await generateRegistrationOptions({
      rpName: 'EConsultor',
      rpID,
      userName: user.email,
      userDisplayName: user.displayName,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });
    put(`reg:${user.id}`, options.challenge, user.id);
    return options;
  });

  app.post('/register/verify', { ...auth, ...strict }, async (req) => {
    const body = z.object({ response: z.custom<RegistrationResponseJSON>((v) => typeof v === 'object' && v !== null), name: z.string().trim().max(40).optional() }).parse(req.body);
    const user = req.user;
    const ch = take(`reg:${user.id}`);
    if (!ch) throw badRequest('La solicitud caducó. Inténtalo de nuevo.', 'challenge_expired');
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: ch.challenge,
        expectedOrigin: cfg.publicOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      throw badRequest('No se pudo verificar la huella en este dispositivo.', 'passkey_invalid');
    }
    if (!verification.verified) throw badRequest('No se pudo verificar la huella en este dispositivo.', 'passkey_invalid');
    const { credential } = verification.registrationInfo;
    const list = user.passkeys ?? [];
    if (list.some((k) => k.id === credential.id)) throw badRequest('Este dispositivo ya está registrado.', 'passkey_duplicate');
    const rec: PasskeyRecord = {
      id: credential.id,
      publicKey: b64u.enc(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports,
      name: body.name || deviceLabel(req.headers['user-agent']),
      createdAt: new Date().toISOString(),
    };
    user.passkeys = [...list, rec];
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    await audit(req, 'passkey_added', user.id, rec.name);
    return { id: rec.id, name: rec.name, createdAt: rec.createdAt };
  });

  app.delete('/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(512) }).parse(req.params);
    const user = req.user;
    const list = user.passkeys ?? [];
    const gone = list.find((k) => k.id === id);
    if (!gone) throw new AppError(404, 'not_found', 'Dispositivo no encontrado');
    // Sin contraseña ni Google, la huella sería la única forma de entrar: no se permite quitar la última.
    if (!user.passwordHash && !user.googleSub && methodsLeft(user) === 1) throw badRequest('Es tu único método de acceso; añade otro antes de quitarlo.', 'last_login_method');
    user.passkeys = list.filter((k) => k.id !== id);
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    await audit(req, 'passkey_removed', user.id, gone.name);
    return { ok: true };
  });

  // ── Inicio de sesión (sin sesión previa) ──
  app.post('/login/options', strict, async () => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    const challengeId = randomToken(18);
    put(`auth:${challengeId}`, options.challenge);
    return { challengeId, options };
  });

  app.post('/login/verify', strict, async (req, reply) => {
    const body = z.object({ challengeId: z.string().min(10).max(100), response: z.custom<AuthenticationResponseJSON>((v) => typeof v === 'object' && v !== null) }).parse(req.body);
    const ch = take(`auth:${body.challengeId}`);
    const fail = () => unauthorized('No se pudo iniciar sesión con la huella. Usa tu contraseña.', 'passkey_failed');
    if (!ch) throw fail();

    // La llave descubrible trae el id de usuario (userHandle); se comprueba además que la credencial sea suya.
    const handle = body.response.response?.userHandle;
    let userId = '';
    try { userId = handle ? Buffer.from(handle, 'base64url').toString('utf8') : ''; } catch { /* handle ilegible */ }
    const user = userId ? await store.users.byId(userId) : undefined;
    const key = user?.passkeys?.find((k) => k.id === body.response.id);
    if (!user || !key) {
      await audit(req, 'login_failed', undefined, 'passkey_unknown');
      throw fail();
    }
    assertNotLocked(user);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: ch.challenge,
        expectedOrigin: cfg.publicOrigin,
        expectedRPID: rpID,
        credential: { id: key.id, publicKey: b64u.dec(key.publicKey), counter: key.counter, transports: key.transports as never },
        requireUserVerification: true,
      });
    } catch {
      await audit(req, 'login_failed', user.id, 'passkey_invalid');
      throw fail();
    }
    if (!verification.verified) {
      await audit(req, 'login_failed', user.id, 'passkey_invalid');
      throw fail();
    }
    key.counter = verification.authenticationInfo.newCounter;
    key.lastUsedAt = new Date().toISOString();
    return reply.send(await complete(req, reply, user, 'passkey'));
  });

  // ── Huella nativa de la app de Android ──
  // El WebView de Android no admite WebAuthn. La app guarda en el Keystore (protegido por la huella) un secreto
  // aleatorio de 256 bits que el servidor reconoce por su hash. Para usarlo hay que pasar el BiometricPrompt.
  app.post('/biometric/register', { ...auth, ...strict }, async (req) => {
    const body = z.object({ name: z.string().trim().max(40).optional() }).parse(req.body ?? {});
    const user = req.user;
    if ((user.appBiometrics ?? []).length >= MAX_PASSKEYS) throw badRequest(tr('Máximo {max} dispositivos. Elimina alguno primero.', { max: MAX_PASSKEYS }), 'too_many_passkeys');
    const secret = randomToken(32);
    const rec: AppBiometricRecord = {
      id: randomToken(12),
      name: body.name || `${deviceLabel(req.headers['user-agent'])} · app`,
      secretHash: sha256(secret),
      createdAt: new Date().toISOString(),
    };
    user.appBiometrics = [...(user.appBiometrics ?? []), rec];
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    await audit(req, 'passkey_added', user.id, rec.name);
    // El secreto solo se entrega ahora; el servidor no puede volver a darlo.
    return { userId: user.id, id: rec.id, secret, name: rec.name, createdAt: rec.createdAt };
  });

  app.post('/biometric/login', strict, async (req, reply) => {
    const body = z.object({ userId: z.string().min(8).max(80), id: z.string().min(8).max(80), secret: z.string().min(20).max(200) }).parse(req.body);
    const fail = () => unauthorized('No se pudo iniciar sesión con la huella. Usa tu contraseña.', 'passkey_failed');
    const user = await store.users.byId(body.userId);
    const dev = user?.appBiometrics?.find((d) => d.id === body.id);
    if (!user || !dev) {
      await audit(req, 'login_failed', undefined, 'biometric_unknown');
      throw fail();
    }
    assertNotLocked(user);
    if (!sameHash(dev.secretHash, sha256(body.secret))) {
      await audit(req, 'login_failed', user.id, 'biometric_invalid');
      throw fail();
    }
    dev.lastUsedAt = new Date().toISOString();
    return reply.send(await complete(req, reply, user, 'app_biometric'));
  });

  app.delete('/biometric/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.params);
    const user = req.user;
    const list = user.appBiometrics ?? [];
    const gone = list.find((k) => k.id === id);
    if (!gone) throw new AppError(404, 'not_found', 'Dispositivo no encontrado');
    if (!user.passwordHash && !user.googleSub && methodsLeft(user) === 1) throw badRequest('Es tu único método de acceso; añade otro antes de quitarlo.', 'last_login_method');
    user.appBiometrics = list.filter((k) => k.id !== id);
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    await audit(req, 'passkey_removed', user.id, gone.name);
    return { ok: true };
  });
}

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { AppError, unauthorized } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { dataRoutes } from './routes/data.js';
import { importRoutes } from './routes/import.js';
import { notificationRoutes } from './routes/notifications.js';
import { idleExpired, noteActivity } from './security/idle.js';
import { verifyAccess } from './security/tokens.js';
import type { Store, UserRecord } from './store/types.js';

declare module 'fastify' {
  interface FastifyInstance {
    cfg: Config;
    store: Store;
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: UserRecord;
    sessionId: string;
  }
}

export async function buildApp(cfg: Config, store: Store): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      cfg.env === 'test'
        ? false
        : {
            level: cfg.isProd ? 'info' : 'debug',
            // Jamás registrar credenciales ni cookies.
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          },
    trustProxy: cfg.trustProxy,
    bodyLimit: 100 * 1024,
  });

  app.decorate('cfg', cfg);
  app.decorate('store', store);
  app.decorateRequest('user', null as unknown as UserRecord);
  app.decorateRequest('sessionId', '');

  // ── Seguridad transversal ──
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: cfg.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cors, {
    origin: [cfg.publicOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization', 'x-requested-with', 'x-user-active'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  // Nunca cachear respuestas de la API (datos financieros).
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api')) reply.header('cache-control', 'no-store');
  });

  // ── Autenticación ──
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw unauthorized();
    const claims = await verifyAccess(cfg.accessSecret, token);
    if (!claims) throw unauthorized('Sesión caducada', 'token_expired');
    const session = await store.sessions.byId(claims.sid);
    if (!session || session.revokedAt || session.userId !== claims.sub) throw unauthorized('Sesión revocada', 'session_revoked');
    const user = await store.users.byId(claims.sub);
    if (!user) throw unauthorized();
    // Cierre por inactividad: salvo que la persona haya elegido «Mantener conectado».
    if (idleExpired(cfg, user, session)) {
      await store.sessions.revokeFamily(session.familyId);
      throw unauthorized('Sesión cerrada por inactividad', 'idle_timeout');
    }
    // Solo cuenta como actividad lo que la persona hace (la web lo marca); no el refresco en segundo plano.
    if (req.headers['x-user-active'] === '1') await noteActivity(store, session);
    req.user = user;
    req.sessionId = claims.sid;
  });

  // ── Errores uniformes (sin filtrar detalles internos) ──
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation_error', message: err.issues[0]?.message ?? 'Datos no válidos', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err.statusCode === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Demasiados intentos. Espera un momento.' });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    req.log.error({ err }, 'unhandled');
    return reply.status(500).send({ error: 'internal', message: 'Error interno' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ready', time: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(dataRoutes, { prefix: '/api' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(importRoutes, { prefix: '/api/import' });

  // ── Web compilada (opcional): un único proceso sirve API + PWA en un servidor casero ──
  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    const root = resolve(cfg.staticDir);
    await app.register(fastifyStatic, { root, wildcard: false, setHeaders: (res, path) => {
      if (path.endsWith('sw.js') || path.endsWith('index.html')) res.setHeader('cache-control', 'no-cache');
      else if (path.includes('/assets/')) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    } });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found', message: 'No encontrado' });
    });
  }

  return app;
}

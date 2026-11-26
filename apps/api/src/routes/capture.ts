import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isoDate } from '@econsultor/shared';
import { unauthorized } from '../lib/errors.js';
import { accept, acceptAll, captureInput, clearIgnored, createToken, discard, infoOf, ingest, revokeToken, setMode, userForToken } from '../modules/capture/service.js';
import { TOKEN_PREFIX } from '../modules/capture/token.js';

/**
 * Captura de pagos desde el móvil. `POST /in` es público pero exige el token personal (solo permite AÑADIR pendientes y
 * no devuelve ningún dato); el resto lo gestiona la persona con su sesión.
 */
export async function captureRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };
  const rate = (max: number) => ({ rateLimit: { max: cfg.env === 'test' ? 10_000 : max, timeWindow: '1 minute' } });

  app.post('/in', { bodyLimit: 16 * 1024, config: rate(60) }, async (req, reply) => {
    const body = captureInput.parse(req.body ?? {});
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
    const token = (bearer ?? body.token ?? '').trim();
    const user = token.startsWith(TOKEN_PREFIX) ? await userForToken(store, token) : undefined;
    if (!user) throw unauthorized('Token de captura no válido', 'bad_capture_token');
    const { token: _t, ...input } = body;
    const r = await ingest(cfg, store, user.id, input);
    // Nada de datos en la respuesta: si alguien viera el token, solo podría añadir avisos, nunca leer.
    return reply.code(r.status === 'limit' ? 429 : 200).send({ ok: r.status !== 'limit', status: r.status });
  });

  app.get('/', auth, async (req) => infoOf(cfg, req.user));

  app.post('/token', { ...auth, config: rate(10) }, async (req) => {
    const token = await createToken(store, req.user.id);
    return { token, ...infoOf(cfg, (await store.users.byId(req.user.id))!) };
  });

  app.delete('/token', auth, async (req) => {
    await revokeToken(store, req.user.id);
    return infoOf(cfg, (await store.users.byId(req.user.id))!);
  });

  app.put('/settings', auth, async (req) => {
    const { mode } = z.object({ mode: z.enum(['smart', 'review', 'auto']) }).parse(req.body);
    await setMode(store, req.user.id, mode);
    return infoOf(cfg, (await store.users.byId(req.user.id))!);
  });

  const idParam = z.object({ id: z.string().min(1).max(64) });

  app.post('/items/:id/accept', { ...auth, config: rate(120) }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = z.object({ categoryId: z.string().min(1).max(40).optional(), merchant: z.string().trim().min(1).max(200).optional(), amountMinor: z.number().int().positive().max(10_000_000_000).optional(), date: isoDate.optional() }).parse(req.body ?? {});
    const tx = await accept(store, req.user.id, id, o);
    return { transaction: tx, ...infoOf(cfg, (await store.users.byId(req.user.id))!) };
  });

  app.post('/items/accept-all', { ...auth, config: rate(20) }, async (req) => {
    const r = await acceptAll(store, req.user.id);
    return { ...r, ...infoOf(cfg, (await store.users.byId(req.user.id))!) };
  });

  app.delete('/items/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    await discard(store, req.user.id, id === 'all' ? 'all' : id);
    return infoOf(cfg, (await store.users.byId(req.user.id))!);
  });

  app.delete('/ignored/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    await clearIgnored(store, req.user.id, id === 'all' ? 'all' : id);
    return infoOf(cfg, (await store.users.byId(req.user.id))!);
  });

  // Un pago de ejemplo por el mismo camino que uno real: así se comprueba que el móvil y el servidor se entienden.
  app.post('/test', { ...auth, config: rate(10) }, async (req) => {
    const r = await ingest(cfg, store, req.user.id, { source: 'manual', merchant: 'Café de prueba', amount: 3.5 }, { test: true });
    return { status: r.status, ...infoOf(cfg, (await store.users.byId(req.user.id))!) };
  });
}

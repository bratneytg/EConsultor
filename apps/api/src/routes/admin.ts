import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clearAdviceCache } from '../modules/advice/advisor.js';
import { effectivePlan } from '../lib/plan.js';

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * Rutas internas para el panel del servidor. Solo existen si `ADMIN_TOKEN` está definido, y exigen esa clave
 * en la cabecera `x-admin-token`. El panel las llama desde la red interna de Docker; aun así están protegidas
 * (clave larga, comparación en tiempo constante, límite de intentos) porque la app también está en internet.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const token = cfg.adminToken;

  app.post('/plan', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const dado = String(req.headers['x-admin-token'] ?? '');
    if (!token || !dado || !timingSafeEqual(sha(dado), sha(token))) {
      req.log.warn({ ip: req.ip }, '[admin] clave incorrecta');
      return reply.code(401).send({ error: 'No autorizado' });
    }
    const body = z.object({ email: z.string().trim().toLowerCase().min(1).max(254), plan: z.enum(['free', 'premium', 'auto']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Datos no válidos' });

    const user = await store.users.byEmail(body.data.email);
    if (!user) return reply.code(404).send({ error: 'No existe esa cuenta' });

    const antes = effectivePlan(cfg, user);
    const ahora = new Date().toISOString();
    if (body.data.plan === 'auto') delete user.planOverride;
    else { user.planOverride = body.data.plan; user.plan = body.data.plan; }
    user.updatedAt = ahora;
    await store.users.update(user);
    clearAdviceCache(user.id);
    await store.audit.append({ id: randomUUID(), userId: user.id, type: 'plan_changed', at: ahora, ip: req.ip, detail: `${antes}→${body.data.plan} (panel)` });
    await store.flush(); // el panel lee el archivo de datos: debe estar ya escrito cuando le respondamos
    req.log.info({ userId: user.id }, `[admin] plan ${antes} → ${body.data.plan}`);
    return { email: user.email, plan: effectivePlan(cfg, user), ajuste: user.planOverride ?? null };
  });
}

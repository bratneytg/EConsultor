import type { FastifyInstance } from 'fastify';
import webpush from 'web-push';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const subscription = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };

  if (cfg.vapid) webpush.setVapidDetails(cfg.vapid.subject, cfg.vapid.publicKey, cfg.vapid.privateKey);

  app.get('/config', async () => ({ publicKey: cfg.vapid?.publicKey ?? null }));

  app.post('/subscribe', auth, async (req) => {
    if (!cfg.vapid) throw new AppError(501, 'push_disabled', 'Las notificaciones push no están configuradas en el servidor');
    const sub = subscription.parse(req.body);
    await store.push.upsert({ endpoint: sub.endpoint, keys: sub.keys, userId: req.user.id, createdAt: new Date().toISOString() });
    return { ok: true };
  });

  app.post('/unsubscribe', auth, async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await store.push.remove(req.user.id, endpoint);
    return { ok: true };
  });

  app.post('/test', { ...auth, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req) => {
    if (!cfg.vapid) throw new AppError(501, 'push_disabled', 'Las notificaciones push no están configuradas en el servidor');
    const subs = await store.push.forUser(req.user.id);
    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: 'EConsultor', body: 'Las notificaciones funcionan ✅', url: '/' }));
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await store.push.remove(req.user.id, s.endpoint);
      }
    }
    return { sent };
  });
}

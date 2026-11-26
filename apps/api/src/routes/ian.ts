import type { FastifyInstance } from 'fastify';
import { ianChatInput, type IanReply, type IanStatus } from '@econsultor/shared';
import { todayIn } from '../lib/dates.js';
import { AppError, forbidden } from '../lib/errors.js';
import { effectivePlan } from '../lib/plan.js';
import { askIan } from '../modules/ian/agent.js';
import { give, remaining, take } from '../modules/ian/quota.js';
import { syncRecurring } from '../modules/recurring/service.js';

/** Ian: el asistente con IA que contesta preguntas sobre los datos de la persona. Solo cuentas Premium. */
export async function ianRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };

  app.get('/', auth, async (req): Promise<IanStatus> => {
    const premium = effectivePlan(cfg, req.user) === 'premium';
    const day = todayIn(req.user.timezone);
    return { available: premium && !!cfg.anthropicApiKey, premium, limit: cfg.ianDailyLimit, remaining: remaining(req.user.id, day, cfg.ianDailyLimit) };
  });

  app.post('/chat', { ...auth, config: { rateLimit: { max: cfg.env === 'test' ? 10_000 : 12, timeWindow: '1 minute' } } }, async (req): Promise<IanReply> => {
    if (effectivePlan(cfg, req.user) !== 'premium') throw forbidden('Ian es una función de Premium', 'premium_required');
    if (!cfg.anthropicApiKey) throw new AppError(503, 'ian_unavailable', 'Ian no está disponible ahora mismo. Inténtalo más tarde.');
    const { messages } = ianChatInput.parse(req.body);
    // La conversación empieza por la persona y termina en su pregunta.
    const turns = messages.slice(messages.findIndex((m) => m.role === 'user'));
    if (!turns.length || turns[turns.length - 1]!.role !== 'user') throw new AppError(400, 'bad_request', 'Escribe una pregunta para Ian.');

    const day = todayIn(req.user.timezone);
    if (!take(req.user.id, day, cfg.ianDailyLimit)) throw new AppError(429, 'ian_daily_limit', 'Has llegado al límite de mensajes de hoy. Mañana podrás seguir hablando con Ian.');

    await syncRecurring(store, req.user);
    const txs = await store.transactions.list(req.user.id);
    const r = await askIan(cfg, { user: req.user, txs, today: day }, turns);
    if ('issue' in r) {
      give(req.user.id, day);
      if (r.issue === 'no_key' || r.issue === 'key' || r.issue === 'model') throw new AppError(503, 'ian_unavailable', 'Ian no está disponible ahora mismo. Inténtalo más tarde.');
      throw new AppError(503, 'ian_busy', 'Ian no ha podido responder ahora. Inténtalo de nuevo en un momento.');
    }
    return { reply: r.reply, remaining: remaining(req.user.id, day, cfg.ianDailyLimit) };
  });
}

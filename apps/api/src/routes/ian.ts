import type { FastifyInstance } from 'fastify';
import { ianChatInput, type IanReply, type IanStatus, type Transaction } from '@econsultor/shared';
import { todayIn } from '../lib/dates.js';
import { AppError, forbidden } from '../lib/errors.js';
import { effectivePlan } from '../lib/plan.js';
import { askIan } from '../modules/ian/agent.js';
import { give, remaining, take } from '../modules/ian/quota.js';
import { canNudge, markNudged, unclassifiedGroups, worthAsking } from '../modules/ian/unclassified.js';
import { clearAdviceCache } from '../modules/advice/advisor.js';
import { syncRecurring } from '../modules/recurring/service.js';

/** Ian: el asistente con IA que contesta preguntas sobre los datos de la persona. Solo cuentas Premium. */
export async function ianRoutes(app: FastifyInstance): Promise<void> {
  const { store, cfg } = app;
  const auth = { preHandler: app.requireAuth };

  app.get('/', auth, async (req): Promise<IanStatus> => {
    const premium = effectivePlan(cfg, req.user) === 'premium';
    const day = todayIn(req.user.timezone);
    const available = premium && !!cfg.anthropicApiKey;
    // Solo se cuenta si Ian puede ayudar: así la pantalla ofrece «clasificar gastos» únicamente cuando hay algo que hacer.
    const u = available ? unclassifiedGroups(await store.transactions.list(req.user.id)) : null;
    return { available, premium, limit: cfg.ianDailyLimit, remaining: remaining(req.user.id, day, cfg.ianDailyLimit), unclassified: u && worthAsking(u) ? u.count : 0 };
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
    const userId = req.user.id;
    // Casualmente: como mucho una vez al día Ian puede sacar el tema de los gastos sin clasificar (tras contestar lo que se le preguntó).
    const nudge = canNudge(userId, day) && worthAsking(unclassifiedGroups(txs));
    let changed = false;
    const reclassify = async (list: Transaction[], categoryId: string): Promise<void> => {
      changed = true;
      const now = new Date().toISOString();
      for (const t of list) await store.transactions.update(userId, { ...t, categoryId, updatedAt: now });
      clearAdviceCache(userId);
    };
    const create = async (t: Transaction): Promise<void> => { changed = true; await store.transactions.create(userId, t); clearAdviceCache(userId); };
    const remove = async (t: Transaction): Promise<void> => { changed = true; await store.transactions.delete(userId, t.id); clearAdviceCache(userId); };
    const r = await askIan(cfg, { user: req.user, txs, today: day, reclassify, create, remove, nudge }, turns);
    if ('issue' in r) {
      give(req.user.id, day);
      if (r.issue === 'no_key' || r.issue === 'key' || r.issue === 'model') throw new AppError(503, 'ian_unavailable', 'Ian no está disponible ahora mismo. Inténtalo más tarde.');
      throw new AppError(503, 'ian_busy', 'Ian no ha podido responder ahora. Inténtalo de nuevo en un momento.');
    }
    if (nudge) markNudged(userId, day);
    return { reply: r.reply, remaining: remaining(req.user.id, day, cfg.ianDailyLimit), ...(changed ? { changed: true } : {}) };
  });
}

import type { Advice, AdviceResponse, Overview, Plan, Transaction } from '@econsultor/shared';
import type { Config } from '../../config.js';
import { monthOf } from '../../lib/dates.js';
import { buildOverview } from '../analytics/analytics.js';
import { buildFinancialProfile } from '../profile/engine.js';
import { claudeAdvice, claudeDetailedAdvice } from './claude.js';
import { buildSpendingDetail, detailedAdvice, MIN_DETAIL_TX } from './detailed.js';
import { ruleBasedAdvice } from './rules.js';
import { curLang } from '../../lib/i18n.js';

export const FREE_LIMIT = 3;

interface Cached {
  key: string;
  at: number;
  source: 'rules' | 'ai';
  items: Advice[];
}

/** Caché por usuario: la IA solo se llama si cambian los datos o pasan 6 h (control de coste y latencia). */
const cache = new Map<string, Cached>();
const TTL = 6 * 3600_000;

export async function getAdvice(
  cfg: Config,
  args: { userId: string; plan: Plan; currency: string; today: string; txs: Transaction[]; refresh?: boolean },
): Promise<AdviceResponse> {
  const { userId, plan, currency, today, txs, refresh } = args;
  const profile = buildFinancialProfile(txs, today);
  const overview: Overview = buildOverview(txs, { month: monthOf(today), today, currency });

  const latest = txs.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), '');
  const key = `${plan}|${txs.length}|${latest}|${today}|${curLang()}`;
  const hit = cache.get(userId);

  let source: 'rules' | 'ai' = 'rules';
  let items: Advice[];
  let at = Date.now();

  if (hit && hit.key === key && Date.now() - hit.at < TTL && !(refresh && plan === 'premium')) {
    ({ items, source, at } = hit);
  } else {
    const rules = ruleBasedAdvice(profile, overview);
    items = rules;
    if (plan === 'premium' && txs.length >= 10) {
      const ai = await claudeAdvice(cfg, profile, overview);
      if (ai) {
        source = 'ai';
        // La IA va primero; las reglas completan con lo específico que no se haya cubierto.
        items = [...ai, ...rules.filter((r) => r.scope === 'specific' && r.severity === 'warn')];
      }
    }
    at = Date.now();
    cache.set(userId, { key, at, source, items });
  }

  const visible = plan === 'premium' ? items : items.slice(0, FREE_LIMIT);
  return {
    source,
    plan,
    generatedAt: new Date(at).toISOString(),
    items: visible,
    lockedCount: items.length - visible.length,
  };
}

const detailedCache = new Map<string, Cached>();
/** Consejos que bajan al detalle (comercios, frecuencia, importes). Siempre hay versión local; la IA solo si la persona lo pide (`useAi`). */
export async function getDetailedAdvice(
  cfg: Config,
  args: { userId: string; plan: Plan; currency: string; today: string; txs: Transaction[]; refresh?: boolean; useAi?: boolean },
): Promise<AdviceResponse> {
  const { userId, plan, currency, today, txs, refresh } = args;
  const detail = buildSpendingDetail(txs, today, currency);
  const aiAvailable = !!cfg.anthropicApiKey && plan === 'premium' && detail.txCount >= MIN_DETAIL_TX;
  const wantAi = !!args.useAi && aiAvailable;

  const latest = txs.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), '');
  const key = `${plan}|${txs.length}|${latest}|${today}|${wantAi ? 'ai' : 'local'}|${curLang()}`;
  const hit = detailedCache.get(userId);

  let items: Advice[];
  let source: 'rules' | 'ai' = 'rules';
  let at = Date.now();
  if (hit && hit.key === key && Date.now() - hit.at < TTL && !refresh) {
    ({ items, source, at } = hit);
  } else {
    items = detailedAdvice(detail);
    if (wantAi) {
      const ai = await claudeDetailedAdvice(cfg, detail);
      if (ai) { items = ai; source = 'ai'; }
    }
    at = Date.now();
    detailedCache.set(userId, { key, at, source, items });
  }

  // Gratis: se ven los 2 primeros; el resto se desbloquea con Premium.
  const visible = plan === 'premium' ? items : items.slice(0, 2);
  return {
    source, plan, generatedAt: new Date(at).toISOString(), items: visible, lockedCount: items.length - visible.length,
    basis: { periodDays: detail.periodDays, txCount: detail.txCount, merchants: detail.merchants.length, aiAvailable },
  };
}

export const clearAdviceCache = (userId: string): void => { cache.delete(userId); detailedCache.delete(userId); };

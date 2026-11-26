import type { Advice, AiIssue, Overview } from '@econsultor/shared';
import { categoryById } from '@econsultor/shared';
import type { Config } from '../../config.js';
import { parseAdviceList } from './ai-parse.js';
import { scrub } from '../import/ai.js';
import type { FinancialProfile } from '../profile/engine.js';
import type { SpendingDetail } from './detailed.js';
import { LANG_NAME_ES, curLang } from '../../lib/i18n.js';

/** Añade al final del prompt el idioma en el que debe redactar la IA (el de la persona). */
export const withLang = (sys: string): string => `${sys}\nIDIOMA DE RESPUESTA: redacta todos los textos (títulos, cuerpos y acciones) en ${LANG_NAME_ES[curLang()]}. Los nombres de categoría y de comercio que recibas déjalos como vienen.`;

const SYSTEM = `Eres el coach financiero de EConsultor, una app de economía personal. Respondes SIEMPRE en el idioma que se indica al final de estas instrucciones, con tono cercano, claro y motivador.
Recibirás un resumen numérico y anónimo (importes en céntimos) del perfil financiero de un usuario. Genera entre 4 y 6 consejos concretos y accionables, mezclando:
 - consejos específicos basados en sus números (cita cifras reales, convertidas a la moneda indicada),
 - al menos un consejo para AUMENTAR ingresos y uno para optimizar gastos,
 - un reconocimiento si hay algo que va bien.
Reglas: no eres asesor financiero regulado; no recomiendes productos, marcas, criptomonedas ni valores concretos; no inventes datos que no estén en el resumen; no pidas datos personales.
Devuelve ÚNICAMENTE un array JSON válido, sin texto adicional, con objetos de la forma:
{"kind":"saving|spending|income|habit|risk|win","severity":"info|tip|warn|win","title":"…(máx. 80 car.)","body":"…(máx. 400 car.)","impactMinor": entero opcional con el ahorro/ganancia mensual estimada en céntimos}`;

/** Datos mínimos y agregados que se envían al modelo: nunca notas ni transacciones individuales. */
function digest(p: FinancialProfile, o: Overview) {
  return {
    currency: o.currency,
    monthsOfData: p.monthsOfData,
    avgMonthlyIncomeMinor: p.avgIncomeMinor,
    avgMonthlyExpenseMinor: p.avgExpenseMinor,
    savingsRatePct: Math.round(p.savingsRate * 100),
    fixedCostsPctOfIncome: Math.round(p.fixedRatio * 100),
    discretionaryPctOfExpenses: Math.round(p.discretionaryShare * 100),
    incomeVolatility: Number(p.incomeCV.toFixed(2)),
    expenseTrend: p.expenseTrend,
    incomeSources: p.incomeSources,
    subscriptionsMonthlyMinor: p.subscriptionsMinor,
    weekendSpendingRatio: Number(p.weekendBias.toFixed(2)),
    loggingConsistencyPct: Math.round(p.loggingConsistency * 100),
    archetype: p.archetype,
    riskScore: p.riskScore,
    topExpenseCategories: p.topCategories.map((c) => ({
      category: categoryById(c.categoryId)?.label ?? c.categoryId,
      sharePct: Math.round(c.share * 100),
      avgMonthlyMinor: c.avgMinor,
    })),
    thisMonth: {
      incomeMinor: o.totals.incomeMinor,
      expenseMinor: o.totals.expenseMinor,
      projectedNetMinor: o.forecast.projectedNetMinor,
      healthScore: o.health.score,
    },
  };
}

export type AiResult<T> = { items: T } | { issue: AiIssue };

/** Qué falla según lo que contesta la API de Anthropic (se usa también en Ian). */
export function issueOf(status: number, msg: string): AiIssue {
  if (status === 401 || status === 403) return 'key';
  if (status === 404 || (status === 400 && /model/i.test(msg))) return 'model';
  if (status === 429 || (status === 400 && /credit|balance|billing/i.test(msg))) return 'limit';
  return 'busy';
}

/** Llama a Claude y, si falla, dice POR QUÉ (se apunta en el registro del servidor, nunca la clave). */
async function callClaude(cfg: Config, system: string, content: string, maxTokens: number, timeoutMs: number, signal?: AbortSignal): Promise<{ text: string; stop?: string } | { issue: AiIssue }> {
  if (!cfg.anthropicApiKey) return { issue: 'no_key' };
  const fail = (issue: AiIssue, detail: string): { issue: AiIssue } => { console.error(`[IA] no ha respondido: ${issue} (${detail}) · modelo ${cfg.anthropicModel}`); return { issue }; };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { type?: string; message?: string } } | null;
      const msg = body?.error?.message ?? '';
      const detail = `HTTP ${res.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`;
      return fail(issueOf(res.status, msg), detail);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    // Se juntan todos los bloques de texto (el modelo puede repartir la respuesta en varios).
    return { text: (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'), stop: data.stop_reason };
  } catch (e) {
    return fail('network', e instanceof Error ? e.message : 'error');
  }
}

/** Lee la respuesta; si no hay forma, apunta en el registro qué llegó (para poder arreglarlo) y devuelve null. */
const readList = (r: { text: string; stop?: string }, detailed: boolean) => {
  const items = parseAdviceList(r.text, detailed);
  if (!items) console.error(`[IA] respuesta ilegible (stop_reason=${r.stop ?? '?'}, ${r.text.length} caracteres). Empieza así: ${JSON.stringify(r.text.slice(0, 240))}`);
  else if (r.stop === 'max_tokens') console.warn(`[IA] la respuesta se cortó por longitud; se usaron ${items.length} consejos completos.`);
  return items;
};

/** Asesor con IA (Claude). Si falla devuelve el motivo y el llamador usa las reglas. */
export async function claudeAdvice(cfg: Config, p: FinancialProfile, o: Overview, signal?: AbortSignal): Promise<AiResult<Advice[]>> {
  const r = await callClaude(cfg, withLang(SYSTEM), JSON.stringify(digest(p, o)), 4000, 45_000, signal);
  if ('issue' in r) return r;
  const items = readList(r, false);
  return items ? { items: items.map((it, i) => ({ id: `ai-${i}`, scope: 'specific' as const, ...it })) } : { issue: 'format' };
}


const DETAILED_SYSTEM = `Eres el analista de gastos de EConsultor, una app de economía personal. Respondes SIEMPRE en el idioma que se indica al final de estas instrucciones, tono cercano y directo.
Recibirás un análisis agregado de los gastos de una persona en los últimos ~90 días (importes en céntimos): categorías con ticket medio y frecuencia, comercios principales, cargos recurrentes, gastos pequeños repetidos y gastos grandes.
Tu trabajo: 5 a 8 consejos PRÁCTICOS y muy concretos para reducir o reorganizar SUS gastos habituales. Cada consejo debe:
 - nombrar comercios, categorías y cifras reales del resumen (en la moneda indicada, no en céntimos),
 - proponer una acción que pueda hacer esta semana (tope concreto, cambio de hábito, cancelar o renegociar un cargo, sustituir un gasto),
 - estimar el ahorro mensual realista en "impactMinor" (céntimos), sin exagerar,
 - ordenarse de mayor a menor impacto.
Incluye como máximo un consejo "win" si algo mejoró. Reglas: no eres asesor financiero regulado; no recomiendes productos financieros, inversiones, criptomonedas ni marcas concretas de sustitución; no inventes comercios ni cifras que no estén en el resumen; no pidas datos personales; si hay muchos gastos sin clasificar, dilo.
Devuelve ÚNICAMENTE un array JSON válido: {"kind":"saving|spending|income|habit|risk|win","severity":"info|tip|warn|win","title":"…(máx. 80 car.)","body":"…diagnóstico con cifras (máx. 400 car.)","action":"…qué hacer exactamente (máx. 300 car.)","impactMinor": entero}`;

/** Resumen para la IA: agregados y nombres de comercio saneados (sin IBAN, correos ni números largos). Nunca movimientos sueltos con fecha. */
export function detailedDigest(d: SpendingDetail) {
  const m = (x: { label: string; categoryId: string; totalMinor: number; count: number; avgMinor: number; monthlyMinor: number }) => ({
    merchant: scrub(x.label).slice(0, 40), category: categoryById(x.categoryId)?.label ?? x.categoryId, monthlyMinor: x.monthlyMinor, payments: x.count, avgMinor: x.avgMinor,
  });
  return {
    currency: d.currency,
    periodDays: d.periodDays,
    monthlyExpenseMinor: d.monthlyExpenseMinor,
    variableWeeklyMinor: d.variableWeeklyMinor,
    categories: d.categories.slice(0, 8).map((c) => ({
      category: categoryById(c.categoryId)?.label ?? c.categoryId, monthlyMinor: c.monthlyMinor, sharePct: Math.round(c.share * 100),
      payments: c.count, avgTicketMinor: c.avgTicketMinor, changeVsPrev3MonthsPct: c.changePct, topMerchants: c.merchants.map(m),
    })),
    topMerchants: d.merchants.slice(0, 12).map(m),
    recurring: d.recurring.slice(0, 10).map((r) => ({ merchant: scrub(r.label).slice(0, 40), monthlyMinor: r.monthlyMinor, monthsSeen: r.months })),
    smallFrequent: d.smallFrequent.slice(0, 6).map((s) => ({ merchant: scrub(s.label).slice(0, 40), payments: s.count, avgMinor: s.avgMinor, monthlyMinor: s.monthlyMinor })),
    weekendSharePctOfDiscretionary: Math.round(d.weekend.share * 100),
    unclassified: { pctOfSpending: Math.round(d.unclassified.pct * 100), payments: d.unclassified.count },
    biggestPurchases: d.biggest.map((b) => ({ what: scrub(b.label).slice(0, 40), amountMinor: b.amountMinor })),
  };
}

/** Consejos detallados con IA. Si falla devuelve el motivo y el llamador usa el análisis local. */
export async function claudeDetailedAdvice(cfg: Config, d: SpendingDetail, signal?: AbortSignal): Promise<AiResult<Advice[]>> {
  const r = await callClaude(cfg, withLang(DETAILED_SYSTEM), JSON.stringify(detailedDigest(d)), 6000, 60_000, signal);
  if ('issue' in r) return r;
  const items = readList(r, true);
  return items ? { items: items.map((it, i) => ({ id: `dai-${i}`, scope: 'specific' as const, ...it })) } : { issue: 'format' };
}

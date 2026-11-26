import { z } from 'zod';
import type { Advice, Overview } from '@econsultor/shared';
import { categoryById } from '@econsultor/shared';
import type { Config } from '../../config.js';
import { scrub } from '../import/ai.js';
import type { FinancialProfile } from '../profile/engine.js';
import type { SpendingDetail } from './detailed.js';
import { LANG_NAME_ES, curLang } from '../../lib/i18n.js';

const itemSchema = z.object({
  kind: z.enum(['saving', 'spending', 'income', 'habit', 'risk', 'win']),
  severity: z.enum(['info', 'tip', 'warn', 'win']),
  title: z.string().min(3).max(90),
  body: z.string().min(10).max(500),
  impactMinor: z.number().int().nonnegative().max(1_000_000_00).optional(),
});
const responseSchema = z.array(itemSchema).min(1).max(8);

const detailedItemSchema = itemSchema.extend({ action: z.string().min(10).max(320) });
const detailedResponseSchema = z.array(detailedItemSchema).min(3).max(9);

/** Añade al final del prompt el idioma en el que debe redactar la IA (el de la persona). */
const withLang = (sys: string): string => `${sys}\nIDIOMA DE RESPUESTA: redacta todos los textos (títulos, cuerpos y acciones) en ${LANG_NAME_ES[curLang()]}. Los nombres de categoría y de comercio que recibas déjalos como vienen.`;

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

/** Asesor con IA (Claude). Devuelve `null` ante cualquier fallo para que el llamador use las reglas. */
export async function claudeAdvice(cfg: Config, p: FinancialProfile, o: Overview, signal?: AbortSignal): Promise<Advice[] | null> {
  if (!cfg.anthropicApiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.anthropicModel,
        max_tokens: 1500,
        system: withLang(SYSTEM),
        messages: [{ role: 'user', content: JSON.stringify(digest(p, o)) }],
      }),
      signal: signal ?? AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
    const items = responseSchema.parse(JSON.parse(json));
    return items.map((it, i) => ({ id: `ai-${i}`, scope: 'specific' as const, ...it }));
  } catch {
    return null;
  }
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

/** Consejos detallados con IA. `null` ante cualquier fallo: el llamador usa el análisis local. */
export async function claudeDetailedAdvice(cfg: Config, d: SpendingDetail, signal?: AbortSignal): Promise<Advice[] | null> {
  if (!cfg.anthropicApiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: cfg.anthropicModel,
        max_tokens: 3000,
        system: withLang(DETAILED_SYSTEM),
        messages: [{ role: 'user', content: JSON.stringify(detailedDigest(d)) }],
      }),
      signal: signal ?? AbortSignal.timeout(40_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const items = detailedResponseSchema.parse(JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)));
    return items.map((it, i) => ({ id: `dai-${i}`, scope: 'specific' as const, ...it }));
  } catch {
    return null;
  }
}

import { z } from 'zod';
import type { Advice, Overview } from '@econsultor/shared';
import { categoryById } from '@econsultor/shared';
import type { Config } from '../../config.js';
import type { FinancialProfile } from '../profile/engine.js';

const itemSchema = z.object({
  kind: z.enum(['saving', 'spending', 'income', 'habit', 'risk', 'win']),
  severity: z.enum(['info', 'tip', 'warn', 'win']),
  title: z.string().min(3).max(90),
  body: z.string().min(10).max(500),
  impactMinor: z.number().int().nonnegative().max(1_000_000_00).optional(),
});
const responseSchema = z.array(itemSchema).min(1).max(8);

const SYSTEM = `Eres el coach financiero de EConsultor, una app de economía personal. Respondes SIEMPRE en español, con tono cercano, claro y motivador.
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
        system: SYSTEM,
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

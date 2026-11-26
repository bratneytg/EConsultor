import type { Transaction } from '@econsultor/shared';
import { z } from 'zod';
import { monthOf } from '../../lib/dates.js';
import { categoryLabelFor, prefsOf } from '../../lib/categories.js';
import type { UserRecord } from '../../store/types.js';
import { buildOverview } from '../analytics/analytics.js';
import { buildSpendingDetail } from '../advice/detailed.js';
import { scrub } from '../import/ai.js';

/**
 * Herramientas que Ian puede usar para consultar los datos de LA PERSONA que le habla.
 * Ninguna recibe un identificador de cuenta: trabajan siempre sobre los movimientos de quien pregunta.
 * Los resultados salen saneados (sin IBAN, correos ni números largos) y con importes en la moneda de la cuenta.
 */

export interface IanContext {
  user: Pick<UserRecord, 'currency' | 'categoryPrefs' | 'recurring'>;
  txs: Transaction[];
  today: string;
}

/** Importe en unidades de la moneda (12,5 y no 1250 céntimos): así el modelo no se equivoca de escala. */
const amt = (minor: number): number => Math.round(minor) / 100;
const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const TOOLS = [
  {
    name: 'resumen_mensual',
    description: 'Resumen de un mes: ingresos, gastos, ahorro, comparación con el mes anterior, reparto por categorías y, si es el mes en curso, la previsión a fin de mes.',
    input_schema: { type: 'object', properties: { mes: { type: 'string', description: 'Mes en formato AAAA-MM. Si se omite, el mes actual.' } } },
  },
  {
    name: 'totales_por_categoria',
    description: 'Suma de gastos (o ingresos) por categoría entre dos fechas, ordenada de mayor a menor.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD.' },
        tipo: { type: 'string', enum: ['gasto', 'ingreso'], description: 'Por defecto, gasto.' },
      },
      required: ['desde', 'hasta'],
    },
  },
  {
    name: 'buscar_movimientos',
    description: 'Busca movimientos concretos. Devuelve el número total encontrado, la suma de todos ellos y los primeros (hasta 30).',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD.' },
        hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD.' },
        tipo: { type: 'string', enum: ['gasto', 'ingreso'] },
        categoria: { type: 'string', description: 'Nombre (o parte del nombre) de una categoría.' },
        texto: { type: 'string', description: 'Texto que debe aparecer en la nota o en la categoría del movimiento.' },
        orden: { type: 'string', enum: ['recientes', 'mayor_importe'], description: 'Por defecto, recientes.' },
        limite: { type: 'integer', minimum: 1, maximum: 30 },
      },
    },
  },
  {
    name: 'evolucion_mensual',
    description: 'Ingresos, gastos y ahorro de cada uno de los últimos meses (hasta 12), para ver tendencias.',
    input_schema: { type: 'object', properties: { meses: { type: 'integer', minimum: 1, maximum: 12, description: 'Por defecto, 6.' } } },
  },
  {
    name: 'gastos_periodicos',
    description: 'Los gastos e ingresos que se repiten cada mes y que la persona ha programado (alquiler, nómina, suscripciones…).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'comercios_principales',
    description: 'Dónde se va el dinero en los últimos 90 días: comercios con más gasto, cargos que se repiten y gastos pequeños frecuentes. Los comercios salen de las notas de los movimientos.',
    input_schema: { type: 'object', properties: {} },
  },
] as const;

const periodo = z.object({ desde: date.optional(), hasta: date.optional() });

function inRange(t: Transaction, desde?: string, hasta?: string): boolean {
  return (!desde || t.date >= desde) && (!hasta || t.date <= hasta);
}
const kind = (v?: string): 'income' | 'expense' | undefined => (v === 'ingreso' ? 'income' : v === 'gasto' ? 'expense' : undefined);

/** Ejecuta una herramienta. Lanza un Error con un mensaje útil si los datos de entrada no valen; el bucle se lo devuelve al modelo. */
export function runTool(name: string, input: unknown, ctx: IanContext): unknown {
  const { user, txs, today } = ctx;
  const currency = user.currency;
  const prefs = prefsOf(user);
  const label = (id: string): string => categoryLabelFor(prefs, id);

  switch (name) {
    case 'resumen_mensual': {
      const { mes } = z.object({ mes: month.optional() }).parse(input ?? {});
      const m = mes ?? monthOf(today);
      const o = buildOverview(txs, { month: m, today, currency });
      const cats = (list: typeof o.expenseByCategory) =>
        list.slice(0, 10).map((c) => ({ categoria: label(c.categoryId), importe: amt(c.amountMinor), porcentaje: Math.round(c.share * 100), mes_anterior: amt(c.prevAmountMinor), movimientos: c.count }));
      return {
        mes: m, moneda: currency,
        ingresos: amt(o.totals.incomeMinor), gastos: amt(o.totals.expenseMinor), ahorro: amt(o.totals.netMinor), tasa_de_ahorro_pct: Math.round(o.totals.savingsRate * 100),
        mes_anterior: { ingresos: amt(o.prevTotals.incomeMinor), gastos: amt(o.prevTotals.expenseMinor) },
        gastos_por_categoria: cats(o.expenseByCategory),
        ingresos_por_categoria: cats(o.incomeByCategory),
        ...(m === monthOf(today) ? { prevision_fin_de_mes: { gastos: amt(o.forecast.projectedExpenseMinor), ahorro: amt(o.forecast.projectedNetMinor), dias_transcurridos: o.forecast.daysElapsed, dias_del_mes: o.forecast.daysInMonth } } : {}),
        puntuacion_salud_financiera: o.health.score,
        hay_datos: o.totals.incomeMinor + o.totals.expenseMinor > 0,
      };
    }

    case 'totales_por_categoria': {
      const q = z.object({ desde: date, hasta: date, tipo: z.enum(['gasto', 'ingreso']).optional() }).parse(input ?? {});
      const type = kind(q.tipo) ?? 'expense';
      const by = new Map<string, { sum: number; n: number }>();
      let total = 0;
      for (const t of txs) {
        if (t.type !== type || !inRange(t, q.desde, q.hasta)) continue;
        const a = by.get(t.categoryId) ?? { sum: 0, n: 0 };
        a.sum += t.amountMinor; a.n += 1; by.set(t.categoryId, a); total += t.amountMinor;
      }
      return {
        moneda: currency, desde: q.desde, hasta: q.hasta, tipo: q.tipo ?? 'gasto', total: amt(total),
        categorias: [...by.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 20)
          .map(([id, a]) => ({ categoria: label(id), importe: amt(a.sum), porcentaje: total ? Math.round((a.sum / total) * 100) : 0, movimientos: a.n })),
      };
    }

    case 'buscar_movimientos': {
      const q = periodo.extend({
        tipo: z.enum(['gasto', 'ingreso']).optional(), categoria: z.string().max(60).optional(), texto: z.string().max(60).optional(),
        orden: z.enum(['recientes', 'mayor_importe']).optional(), limite: z.number().int().min(1).max(30).optional(),
      }).parse(input ?? {});
      const type = kind(q.tipo);
      const cat = q.categoria ? norm(q.categoria) : '';
      const text = q.texto ? norm(q.texto) : '';
      let found = txs.filter((t) => {
        if (type && t.type !== type) return false;
        if (!inRange(t, q.desde, q.hasta)) return false;
        const l = norm(label(t.categoryId));
        if (cat && !l.includes(cat) && !norm(t.categoryId).includes(cat)) return false;
        if (text && !norm(`${t.note ?? ''} ${l}`).includes(text)) return false;
        return true;
      });
      found = q.orden === 'mayor_importe'
        ? found.sort((a, b) => b.amountMinor - a.amountMinor)
        : found.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
      const sumExp = found.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountMinor, 0);
      const sumInc = found.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountMinor, 0);
      return {
        moneda: currency, encontrados: found.length, suma_gastos: amt(sumExp), suma_ingresos: amt(sumInc),
        movimientos: found.slice(0, q.limite ?? 15).map((t) => ({
          fecha: t.date, tipo: t.type === 'income' ? 'ingreso' : 'gasto', importe: amt(t.amountMinor), categoria: label(t.categoryId),
          ...(t.note ? { nota: scrub(t.note).slice(0, 80) } : {}), ...(t.account ? { cuenta: t.account } : {}),
        })),
      };
    }

    case 'evolucion_mensual': {
      const { meses } = z.object({ meses: z.number().int().min(1).max(12).optional() }).parse(input ?? {});
      const o = buildOverview(txs, { month: monthOf(today), today, currency });
      return {
        moneda: currency,
        meses: o.monthly.slice(-(meses ?? 6)).map((p) => ({ mes: p.month, ingresos: amt(p.incomeMinor), gastos: amt(p.expenseMinor), ahorro: amt(p.incomeMinor - p.expenseMinor) })),
        nota: 'El último mes puede estar incompleto si aún no ha terminado.',
      };
    }

    case 'gastos_periodicos': {
      const list = (user.recurring ?? []).slice(0, 60);
      return {
        moneda: currency,
        periodicos: list.map((r) => ({ nombre: scrub(r.name).slice(0, 60), tipo: r.type === 'income' ? 'ingreso' : 'gasto', importe_mensual: amt(r.amountMinor), dia_del_mes: r.day, categoria: label(r.categoryId), activo: r.active })),
      };
    }

    case 'comercios_principales': {
      const d = buildSpendingDetail(txs, today, currency);
      const m = (x: { label: string; categoryId: string; monthlyMinor: number; count: number; avgMinor: number }) =>
        ({ comercio: scrub(x.label).slice(0, 40), categoria: label(x.categoryId), gasto_mensual_medio: amt(x.monthlyMinor), pagos: x.count, importe_medio: amt(x.avgMinor) });
      return {
        moneda: currency, dias_analizados: d.periodDays, movimientos_analizados: d.txCount,
        comercios: d.merchants.slice(0, 12).map(m),
        cargos_que_se_repiten: d.recurring.slice(0, 8).map((r) => ({ comercio: scrub(r.label).slice(0, 40), categoria: label(r.categoryId), importe_mensual: amt(r.monthlyMinor), meses_seguidos: r.months })),
        gastos_pequenos_frecuentes: d.smallFrequent.slice(0, 6).map((s) => ({ comercio: scrub(s.label).slice(0, 40), pagos: s.count, importe_medio: amt(s.avgMinor), gasto_mensual: amt(s.monthlyMinor) })),
        sin_clasificar_pct: Math.round(d.unclassified.pct * 100),
      };
    }

    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}

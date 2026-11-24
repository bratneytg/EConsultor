import { categoryById, type Transaction } from '@econsultor/shared';
import { addDays, lastMonths, monthOf, weekdayMon0 } from '../../lib/dates.js';
import { aggregateMonths, type MonthAgg } from '../analytics/analytics.js';

/**
 * PERFIL FINANCIERO (interno).
 *
 * Es la "memoria" algorítmica sobre el usuario: nunca se serializa en ninguna ruta de la API
 * (hay un test que lo garantiza). Solo lo consumen los asesores (reglas / IA) en el servidor.
 * Contiene únicamente agregados: jamás notas libres ni transacciones individuales.
 */
export interface FinancialProfile {
  monthsOfData: number;
  avgIncomeMinor: number;
  avgExpenseMinor: number;
  avgFixedMinor: number;
  avgDiscretionaryMinor: number;
  savingsRate: number; // sobre el promedio
  incomeCV: number; // coeficiente de variación (volatilidad) de ingresos
  expenseCV: number;
  fixedRatio: number; // fijos / ingresos
  discretionaryShare: number; // discrecional / gastos
  topCategories: { categoryId: string; share: number; avgMinor: number }[];
  /** Suscripciones: importe mensual medio. */
  subscriptionsMinor: number;
  weekendBias: number; // gasto/día fin de semana ÷ gasto/día laborable
  loggingConsistency: number; // 0..1 (últimos 30 días)
  expenseTrend: 'rising' | 'flat' | 'falling';
  incomeSources: number;
  archetype: 'saver' | 'balanced' | 'tight' | 'overspender' | 'irregular';
  /** 0 (resiliente) … 100 (vulnerable). */
  riskScore: number;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);
const cv = (xs: number[]): number => {
  const m = mean(xs);
  if (xs.length < 2 || m === 0) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
};
const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n));

export function buildFinancialProfile(txs: Transaction[], today: string): FinancialProfile {
  const aggs = aggregateMonths(txs);
  const currentMonth = monthOf(today);
  const window = lastMonths(currentMonth, 6)
    .map((m) => aggs.get(m))
    .filter((a): a is MonthAgg => !!a && (a.incomeMinor > 0 || a.expenseMinor > 0));

  // El mes en curso está incompleto: lo excluimos de los promedios si hay otros meses.
  const complete = window.filter((a) => a.month !== currentMonth);
  const base = complete.length >= 1 ? complete : window;

  const incomes = base.map((a) => a.incomeMinor);
  const expenses = base.map((a) => a.expenseMinor);
  const avgIncome = mean(incomes);
  const avgExpense = mean(expenses);
  const avgFixed = mean(base.map((a) => a.fixedExpenseMinor));
  const avgDisc = mean(base.map((a) => a.discretionaryMinor));
  const savingsRate = avgIncome > 0 ? (avgIncome - avgExpense) / avgIncome : avgExpense > 0 ? -1 : 0;

  // categorías de gasto
  const catSum = new Map<string, number>();
  for (const a of base) for (const [c, v] of a.byCategory) if (categoryById(c)?.type === 'expense') catSum.set(c, (catSum.get(c) ?? 0) + v);
  const totalExp = sum([...catSum.values()]);
  const topCategories = [...catSum.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([categoryId, v]) => ({ categoryId, share: totalExp ? v / totalExp : 0, avgMinor: Math.round(v / Math.max(1, base.length)) }));

  const subs = mean(base.map((a) => a.byCategory.get('subscriptions') ?? 0));

  // fuentes de ingreso
  const sources = new Set<string>();
  for (const a of base) for (const [c, v] of a.byCategory) if (categoryById(c)?.type === 'income' && v > 0) sources.add(c);

  // sesgo fin de semana (últimos 90 días)
  let wkEnd = 0, wkEndDays = 0, wkDay = 0, wkDayDays = 0;
  const byDate = new Map<string, number>();
  for (const t of txs) if (t.type === 'expense') byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amountMinor);
  for (let i = 0; i < 90; i++) {
    const d = addDays(today, -i);
    const v = byDate.get(d) ?? 0;
    if (weekdayMon0(d) >= 5) { wkEnd += v; wkEndDays++; } else { wkDay += v; wkDayDays++; }
  }
  const weekendBias = wkDay > 0 && wkDayDays > 0 && wkEndDays > 0 ? wkEnd / wkEndDays / (wkDay / wkDayDays) : 1;

  const logged = new Set(txs.map((t) => t.date));
  let loggedDays = 0;
  for (let i = 0; i < 30; i++) if (logged.has(addDays(today, -i))) loggedDays++;

  // tendencia de gasto: último mes completo vs media de los anteriores
  let expenseTrend: FinancialProfile['expenseTrend'] = 'flat';
  if (expenses.length >= 3) {
    const last = expenses[expenses.length - 1]!;
    const before = mean(expenses.slice(0, -1));
    if (before > 0) {
      const ch = (last - before) / before;
      expenseTrend = ch > 0.08 ? 'rising' : ch < -0.08 ? 'falling' : 'flat';
    }
  }

  const incomeCV = cv(incomes);
  const fixedRatio = avgIncome > 0 ? avgFixed / avgIncome : avgFixed > 0 ? 1 : 0;

  const archetype: FinancialProfile['archetype'] =
    incomeCV > 0.35 ? 'irregular' : savingsRate >= 0.25 ? 'saver' : savingsRate >= 0.1 ? 'balanced' : savingsRate >= 0 ? 'tight' : 'overspender';

  const riskScore = Math.round(
    100 * clamp(0.4 * clamp((0.2 - savingsRate) / 0.4) + 0.25 * clamp(incomeCV / 0.5) + 0.2 * clamp((fixedRatio - 0.4) / 0.4) + 0.15 * clamp(cv(expenses) / 0.4)),
  );

  return {
    monthsOfData: base.length,
    avgIncomeMinor: Math.round(avgIncome),
    avgExpenseMinor: Math.round(avgExpense),
    avgFixedMinor: Math.round(avgFixed),
    avgDiscretionaryMinor: Math.round(avgDisc),
    savingsRate,
    incomeCV,
    expenseCV: cv(expenses),
    fixedRatio,
    discretionaryShare: avgExpense > 0 ? avgDisc / avgExpense : 0,
    topCategories,
    subscriptionsMinor: Math.round(subs),
    weekendBias,
    loggingConsistency: loggedDays / 30,
    expenseTrend,
    incomeSources: sources.size,
    archetype,
    riskScore,
  };
}

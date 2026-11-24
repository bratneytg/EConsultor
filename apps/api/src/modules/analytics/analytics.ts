import {
  categoryById,
  type CategoryTotal,
  type DailyPoint,
  type HealthScore,
  type Overview,
  type Transaction,
} from '@econsultor/shared';
import { addDays, daysInMonth, lastMonths, monthOf, shiftMonth, weekdayMon0 } from '../../lib/dates.js';

const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n));
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export interface MonthAgg {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  fixedExpenseMinor: number;
  discretionaryMinor: number;
  byCategory: Map<string, number>;
  daysLogged: number;
}

export function aggregateMonths(txs: Transaction[]): Map<string, MonthAgg> {
  const out = new Map<string, MonthAgg>();
  const days = new Map<string, Set<string>>();
  for (const t of txs) {
    const m = monthOf(t.date);
    let a = out.get(m);
    if (!a) {
      a = { month: m, incomeMinor: 0, expenseMinor: 0, fixedExpenseMinor: 0, discretionaryMinor: 0, byCategory: new Map(), daysLogged: 0 };
      out.set(m, a);
      days.set(m, new Set());
    }
    days.get(m)!.add(t.date);
    a.byCategory.set(t.categoryId, (a.byCategory.get(t.categoryId) ?? 0) + t.amountMinor);
    if (t.type === 'income') a.incomeMinor += t.amountMinor;
    else {
      a.expenseMinor += t.amountMinor;
      const c = categoryById(t.categoryId);
      if (c?.fixed) a.fixedExpenseMinor += t.amountMinor;
      if (c?.discretionary) a.discretionaryMinor += t.amountMinor;
    }
  }
  for (const [m, a] of out) a.daysLogged = days.get(m)!.size;
  return out;
}

const emptyAgg = (month: string): MonthAgg => ({
  month, incomeMinor: 0, expenseMinor: 0, fixedExpenseMinor: 0, discretionaryMinor: 0, byCategory: new Map(), daysLogged: 0,
});

function categoryTotals(txs: Transaction[], prev: Transaction[], type: 'income' | 'expense'): CategoryTotal[] {
  const cur = new Map<string, { amount: number; count: number }>();
  for (const t of txs) {
    if (t.type !== type) continue;
    const e = cur.get(t.categoryId) ?? { amount: 0, count: 0 };
    e.amount += t.amountMinor;
    e.count += 1;
    cur.set(t.categoryId, e);
  }
  const prevMap = new Map<string, number>();
  for (const t of prev) if (t.type === type) prevMap.set(t.categoryId, (prevMap.get(t.categoryId) ?? 0) + t.amountMinor);
  const total = sum([...cur.values()].map((v) => v.amount));
  return [...cur.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      amountMinor: v.amount,
      share: total ? v.amount / total : 0,
      prevAmountMinor: prevMap.get(categoryId) ?? 0,
      count: v.count,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export function streakDays(txs: Transaction[], today: string): number {
  const logged = new Set(txs.map((t) => t.date));
  let cursor = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function healthScore(txs: Transaction[], month: string, today: string): HealthScore {
  const aggs = aggregateMonths(txs);
  const window = lastMonths(month, 3).map((m) => aggs.get(m) ?? emptyAgg(m));
  const income = sum(window.map((a) => a.incomeMinor));
  const expense = sum(window.map((a) => a.expenseMinor));
  const fixed = sum(window.map((a) => a.fixedExpenseMinor));

  const savingsRate = income > 0 ? (income - expense) / income : expense > 0 ? -1 : 0;
  const saving = clamp(savingsRate / 0.2) * 100;

  const fixedRatio = income > 0 ? fixed / income : 1;
  const fixedScore = clamp((0.8 - fixedRatio) / 0.3) * 100;

  const monthlyExpenses = lastMonths(month, 6)
    .map((m) => aggs.get(m)?.expenseMinor ?? 0)
    .filter((v) => v > 0);
  let stability = 50;
  if (monthlyExpenses.length >= 2) {
    const mean = sum(monthlyExpenses) / monthlyExpenses.length;
    const sd = Math.sqrt(sum(monthlyExpenses.map((v) => (v - mean) ** 2)) / monthlyExpenses.length);
    stability = clamp((0.5 - sd / mean) / 0.4) * 100;
  }

  const logged = new Set(txs.map((t) => t.date));
  let loggedDays = 0;
  for (let i = 0; i < 30; i++) if (logged.has(addDays(today, -i))) loggedDays++;
  const consistency = clamp(loggedDays / 20) * 100;

  const parts = [
    { key: 'saving', label: 'Ahorro', value: Math.round(saving), weight: 0.4, hint: 'Objetivo: ahorrar ≥ 20 % de lo que ingresas' },
    { key: 'fixed', label: 'Gastos fijos', value: Math.round(fixedScore), weight: 0.2, hint: 'Ideal: fijos por debajo del 50 % de tus ingresos' },
    { key: 'stability', label: 'Estabilidad', value: Math.round(stability), weight: 0.2, hint: 'Gastos parecidos de un mes a otro' },
    { key: 'consistency', label: 'Constancia', value: Math.round(consistency), weight: 0.2, hint: 'Registrar al menos 20 días al mes' },
  ];
  const score = Math.round(sum(parts.map((p) => p.value * p.weight)));
  const label = score >= 80 ? 'Excelente' : score >= 60 ? 'Sólida' : score >= 40 ? 'En construcción' : 'Atención';
  return { score, label, parts };
}

export interface OverviewOptions {
  month: string;
  today: string;
  currency: string;
}

export function buildOverview(all: Transaction[], { month, today, currency }: OverviewOptions): Overview {
  const prev = shiftMonth(month, -1);
  const monthTx = all.filter((t) => monthOf(t.date) === month);
  const prevTx = all.filter((t) => monthOf(t.date) === prev);
  const aggs = aggregateMonths(all);
  const cur = aggs.get(month) ?? emptyAgg(month);
  const pv = aggs.get(prev) ?? emptyAgg(prev);

  const net = cur.incomeMinor - cur.expenseMinor;
  const savingsRate = cur.incomeMinor > 0 ? net / cur.incomeMinor : 0;

  // ── Serie diaria + saldo acumulado ──
  const dim = daysInMonth(month);
  const todayMonth = monthOf(today);
  const daysElapsed = month < todayMonth ? dim : month === todayMonth ? Number(today.slice(8, 10)) : 0;
  const perDay = new Map<string, { i: number; e: number }>();
  for (const t of monthTx) {
    const d = perDay.get(t.date) ?? { i: 0, e: 0 };
    if (t.type === 'income') d.i += t.amountMinor;
    else d.e += t.amountMinor;
    perDay.set(t.date, d);
  }
  const daily: DailyPoint[] = [];
  let balance = 0;
  for (let day = 1; day <= daysElapsed; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const d = perDay.get(date) ?? { i: 0, e: 0 };
    balance += d.i - d.e;
    daily.push({ date, incomeMinor: d.i, expenseMinor: d.e, balanceMinor: balance });
  }

  // ── Previsión: gasto variable a ritmo actual + fijos/nómina esperados que aún no han llegado ──
  let fixedRemaining = 0;
  for (const [cat, prevAmount] of pv.byCategory) {
    const c = categoryById(cat);
    if (c?.type === 'expense' && c.fixed) fixedRemaining += Math.max(0, prevAmount - (cur.byCategory.get(cat) ?? 0));
  }
  const salaryRemaining = Math.max(0, (pv.byCategory.get('salary') ?? 0) - (cur.byCategory.get('salary') ?? 0));
  const variableSoFar = cur.expenseMinor - cur.fixedExpenseMinor;
  const daysLeft = Math.max(0, dim - daysElapsed);
  const dailyRunRate = daysElapsed > 0 ? Math.round(variableSoFar / daysElapsed) : 0;
  const isOpen = month >= todayMonth;
  const projectedExpense = isOpen ? cur.expenseMinor + (month === todayMonth ? fixedRemaining : 0) + dailyRunRate * daysLeft : cur.expenseMinor;
  const projectedIncome = isOpen && month === todayMonth ? cur.incomeMinor + salaryRemaining : cur.incomeMinor;
  const projectedNet = projectedIncome - projectedExpense;

  const projectedBalance: { date: string; balanceMinor: number }[] = [];
  if (month === todayMonth && daysLeft > 0) {
    const start = balance;
    projectedBalance.push({ date: today, balanceMinor: start });
    for (let i = 1; i <= daysLeft; i++) {
      projectedBalance.push({ date: addDays(today, i), balanceMinor: Math.round(start + ((projectedNet - start) * i) / daysLeft) });
    }
  }

  // ── 12 meses ──
  const monthly = lastMonths(month, 12).map((m) => {
    const a = aggs.get(m);
    return { month: m, incomeMinor: a?.incomeMinor ?? 0, expenseMinor: a?.expenseMinor ?? 0 };
  });

  // ── Mapa de calor: 17 semanas (119 días) hasta hoy ──
  const expenseByDate = new Map<string, number>();
  for (const t of all) if (t.type === 'expense') expenseByDate.set(t.date, (expenseByDate.get(t.date) ?? 0) + t.amountMinor);
  const heatmap = Array.from({ length: 119 }, (_, i) => {
    const date = addDays(today, -(118 - i));
    return { date, expenseMinor: expenseByDate.get(date) ?? 0 };
  });

  // ── Patrón semanal (últimos 91 días) ──
  const wdSum = Array<number>(7).fill(0);
  const wdCnt = Array<number>(7).fill(0);
  for (let i = 0; i < 91; i++) {
    const date = addDays(today, -i);
    const w = weekdayMon0(date);
    wdSum[w]! += expenseByDate.get(date) ?? 0;
    wdCnt[w]! += 1;
  }
  const weekday = wdSum.map((s, w) => ({ weekday: w, avgExpenseMinor: Math.round(s / Math.max(1, wdCnt[w]!)) }));

  const topExpenses = monthTx
    .filter((t) => t.type === 'expense')
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 5);

  return {
    month,
    currency,
    today,
    totals: { incomeMinor: cur.incomeMinor, expenseMinor: cur.expenseMinor, netMinor: net, savingsRate },
    prevTotals: { incomeMinor: pv.incomeMinor, expenseMinor: pv.expenseMinor },
    expenseByCategory: categoryTotals(monthTx, prevTx, 'expense'),
    incomeByCategory: categoryTotals(monthTx, prevTx, 'income'),
    daily,
    forecast: {
      daysInMonth: dim,
      daysElapsed,
      dailyRunRateMinor: dailyRunRate,
      projectedExpenseMinor: projectedExpense,
      projectedNetMinor: projectedNet,
      projectedBalance,
    },
    monthly,
    heatmap,
    weekday,
    topExpenses,
    health: healthScore(all, month, today),
    streakDays: streakDays(all, today),
    loggedToday: all.some((t) => t.date === today),
  };
}

import { categoryById, type Overview, type Transaction } from '@econsultor/shared';
import { curLang, localeOf, tr } from '../../lib/i18n.js';
import { monthOf, shiftMonth } from '../../lib/dates.js';
import { aggregateMonths } from '../analytics/analytics.js';

export interface Narrative {
  /** La idea principal del mes, en una frase o dos. */
  headline: string;
  /** Lo demás, un párrafo corto por idea. */
  paragraphs: string[];
  /** Hasta tres cosas concretas para el mes siguiente. */
  actions: string[];
}

export interface NarrativeContext {
  /** Importe con símbolo de moneda, sin decimales. */
  money: (minor: number) => string;
  /** Nombre de categoría tal como lo ve la persona. */
  label: (categoryId: string) => string;
  /** Suma mensual de los gastos periódicos activos (0 si no hay). */
  recurringMonthlyMinor: number;
  /** ¿Ha configurado ya gastos periódicos? */
  hasRecurring: boolean;
}

export const monthName = (month: string): string =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(localeOf(curLang()), { month: 'long', year: 'numeric', timeZone: 'UTC' });

const dayName = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(localeOf(curLang()), { day: 'numeric', month: 'long', timeZone: 'UTC' });

const pct = (x: number): string => String(Math.round(x * 100));

/**
 * Análisis escrito del mes. Todo sale de los números del mes (nada inventado): reglas sencillas y frases cortas
 * que cualquiera entiende, para que el informe se pueda leer en un minuto.
 */
export function buildNarrative(o: Overview, monthTxs: Transaction[], ctx: NarrativeContext): Narrative {
  const { money, label } = ctx;
  const { incomeMinor: income, expenseMinor: expense, netMinor: net, savingsRate } = o.totals;
  const month = monthName(o.month);
  const prevMonth = monthName(shiftMonth(o.month, -1));
  const paragraphs: string[] = [];
  const actions: string[] = [];

  if (income === 0 && expense === 0) {
    return { headline: tr('En {month} no hay movimientos anotados, así que todavía no hay nada que analizar.', { month }), paragraphs, actions };
  }

  // ── La idea principal ──
  let headline: string;
  if (income > 0 && expense === 0) headline = tr('En {month} ingresaste {income} y no anotaste ningún gasto.', { month, income: money(income) });
  else if (income === 0) headline = tr('En {month} gastaste {expense} y no anotaste ningún ingreso.', { month, expense: money(expense) });
  else if (net >= 0) headline = tr('En {month} ingresaste {income} y gastaste {expense}: te sobraron {net}, el {rate} % de tus ingresos.', { month, income: money(income), expense: money(expense), net: money(net), rate: pct(savingsRate) });
  else headline = tr('En {month} ingresaste {income} y gastaste {expense}: gastaste {deficit} más de lo que entró.', { month, income: money(income), expense: money(expense), deficit: money(-net) });

  // ── Frente al mes anterior ──
  const prevExpense = o.prevTotals.expenseMinor;
  if (expense > 0 && prevExpense > 0) {
    const ch = (expense - prevExpense) / prevExpense;
    const diff = money(Math.abs(expense - prevExpense));
    if (Math.abs(ch) < 0.03) paragraphs.push(tr('El gasto se mantuvo estable respecto a {prev}.', { prev: prevMonth }));
    else if (ch > 0) paragraphs.push(tr('El gasto subió un {pct} % respecto a {prev}: {amount} más.', { pct: pct(ch), prev: prevMonth, amount: diff }));
    else paragraphs.push(tr('El gasto bajó un {pct} % respecto a {prev}: {amount} menos.', { pct: pct(-ch), prev: prevMonth, amount: diff }));
  }

  // ── Dónde se fue ──
  const top = o.expenseByCategory.slice(0, 3);
  const [a, b, c] = top;
  if (a && !b) paragraphs.push(tr('Todo el gasto del mes está en una sola categoría: {a} ({amount}).', { a: label(a.categoryId), amount: money(a.amountMinor) }));
  else if (a && b && !c) {
    paragraphs.push(tr('Tus dos mayores partidas fueron {a} ({amountA}, el {pctA} %) y {b} ({amountB}, el {pctB} %).', {
      a: label(a.categoryId), amountA: money(a.amountMinor), pctA: pct(a.share), b: label(b.categoryId), amountB: money(b.amountMinor), pctB: pct(b.share),
    }));
  } else if (a && b && c) {
    paragraphs.push(tr('Tus tres mayores partidas fueron {a} ({amountA}, el {pctA} %), {b} ({amountB}, el {pctB} %) y {c} ({amountC}, el {pctC} %): juntas suponen el {total} % del gasto.', {
      a: label(a.categoryId), amountA: money(a.amountMinor), pctA: pct(a.share),
      b: label(b.categoryId), amountB: money(b.amountMinor), pctB: pct(b.share),
      c: label(c.categoryId), amountC: money(c.amountMinor), pctC: pct(c.share),
      total: pct(a.share + b.share + c.share),
    }));
  }

  // ── Lo que más cambió ──
  const moves = o.expenseByCategory.map((x) => ({ id: x.categoryId, diff: x.amountMinor - x.prevAmountMinor, prev: x.prevAmountMinor }));
  const up = [...moves].sort((x, y) => y.diff - x.diff)[0];
  // Ni una cifra de calderilla ni un salto pequeño: hace falta que se note.
  const threshold = Math.max(1500, Math.round(expense * 0.03));
  if (prevExpense > 0 && up && up.diff >= threshold) paragraphs.push(tr('{cat} es lo que más ha crecido: {amount} más que en {prev}.', { cat: label(up.id), amount: money(up.diff), prev: prevMonth }));
  const down = [...moves].filter((x) => x.prev > 0).sort((x, y) => x.diff - y.diff)[0];
  if (prevExpense > 0 && down && -down.diff >= threshold) paragraphs.push(tr('{cat} es donde más has recortado: {amount} menos que en {prev}.', { cat: label(down.id), amount: money(-down.diff), prev: prevMonth }));

  // ── Fijo y variable ──
  const agg = aggregateMonths(monthTxs).get(o.month);
  const fixed = agg?.fixedExpenseMinor ?? 0;
  const discretionary = agg?.discretionaryMinor ?? 0;
  if (expense > 0 && fixed > 0) {
    paragraphs.push(tr('Los gastos fijos (vivienda, suministros, suscripciones…) sumaron {fixed}, el {pct} % del gasto. El resto, {variable}, es gasto variable, donde tienes más margen para decidir.', { fixed: money(fixed), pct: pct(fixed / expense), variable: money(expense - fixed) }));
  }
  if (ctx.recurringMonthlyMinor > 0) paragraphs.push(tr('Tus gastos periódicos activos suman {amount} al mes y se anotan solos cada mes.', { amount: money(ctx.recurringMonthlyMinor) }));

  // ── Ritmo ──
  const spendDays = o.daily.filter((d) => d.expenseMinor > 0);
  const peak = [...spendDays].sort((x, y) => y.expenseMinor - x.expenseMinor)[0];
  if (expense > 0 && o.daily.length > 0 && peak) {
    paragraphs.push(tr('Gastaste una media de {daily} al día. El día de más gasto fue el {date}, con {amount}.', { daily: money(Math.round(expense / o.daily.length)), date: dayName(peak.date), amount: money(peak.expenseMinor) }));
  }
  const biggest = o.topExpenses[0];
  if (biggest && o.topExpenses.length > 0 && biggest.amountMinor >= expense * 0.1) {
    paragraphs.push(tr('Tu mayor gasto individual fue de {amount} en {cat}, el {date}.', { amount: money(biggest.amountMinor), cat: label(biggest.categoryId), date: dayName(biggest.date) }));
  }

  // ── Previsión (solo si el mes sigue abierto) ──
  const f = o.forecast;
  if (monthOf(o.today) === o.month && f.daysElapsed >= 5 && f.daysElapsed < f.daysInMonth) {
    paragraphs.push(tr('Si sigues a este ritmo, el mes cerrará con unos {expense} de gasto y un resultado de {net}.', { expense: money(f.projectedExpenseMinor), net: money(f.projectedNetMinor) }));
  }

  paragraphs.push(tr('Tu puntuación de salud financiera es {score} sobre 100 ({label}).', { score: o.health.score, label: tr(o.health.label) }));

  // ── Qué hacer el mes que viene ──
  if (income > 0) {
    if (net < 0) {
      const variable = o.expenseByCategory.find((x) => !categoryById(x.categoryId)?.fixed);
      actions.push(variable
        ? tr('Cierra el desfase de {amount}: busca recortarlo del gasto variable, empezando por {cat}, que es la categoría más grande.', { amount: money(-net), cat: label(variable.categoryId) })
        : tr('Cierra el desfase de {amount}: necesitas gastar menos o ingresar más para llegar a fin de mes.', { amount: money(-net) }));
    } else if (savingsRate < 0.1) {
      actions.push(tr('Un buen primer objetivo es ahorrar el 10 % de lo que ingresas. Te faltan {amount} para llegar: apártalos el mismo día que cobras.', { amount: money(Math.max(0, Math.round(income * 0.1) - net)) }));
    } else if (savingsRate < 0.2) {
      actions.push(tr('Vas bien: ahorras entre el 10 % y el 20 %. Para llegar al 20 % necesitarías apartar {amount} más.', { amount: money(Math.round(income * 0.2) - net) }));
    } else {
      actions.push(tr('Gran mes: has ahorrado más del 20 %. Mueve parte de los {amount} que te sobraron a ahorro o inversión antes de que se diluyan.', { amount: money(net) }));
    }
  }
  if (expense > 0 && discretionary / expense > 0.35) {
    actions.push(tr('El {pct} % de tu gasto es discrecional (ocio, restaurantes, compras…): es la palanca más fácil si quieres ahorrar más.', { pct: pct(discretionary / expense) }));
  }
  if (!ctx.hasRecurring && fixed > 0) {
    actions.push(tr('Añade tus pagos fijos como gastos periódicos (en Ajustes) para que se anoten solos y la previsión sea más fiable.'));
  }
  return { headline, paragraphs, actions: actions.slice(0, 3) };
}

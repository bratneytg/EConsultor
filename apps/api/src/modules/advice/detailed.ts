import { categoryById, type Advice, type Transaction } from '@econsultor/shared';
import { addDays, diffDays, weekdayMon0 } from '../../lib/dates.js';
import { merchantKey } from '../import/merchant.js';
import { curLang, lcName, tr } from '../../lib/i18n.js';
import { money } from './rules.js';

/**
 * ANÁLISIS DETALLADO de gastos.
 * A diferencia del perfil financiero (solo agregados mensuales), aquí se mira DÓNDE se va el dinero:
 * comercios, frecuencia, importe medio, cargos recurrentes y gastos pequeños que se repiten.
 * Se calcula en el servidor propio. Solo si la persona lo pide y lo acepta, un resumen (con los nombres de
 * comercio ya saneados) se envía a la IA para redactar consejos más finos.
 */

const WINDOW_DAYS = 90;

const label = (id: string): string => tr(categoryById(id)?.label ?? id);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export { merchantKey };

interface MerchantAgg {
  key: string;
  label: string;
  categoryVotes: Map<string, number>;
  totalMinor: number;
  count: number;
  months: Set<string>;
  amounts: number[];
  labels: Map<string, number>;
}

export interface MerchantSummary { label: string; categoryId: string; totalMinor: number; count: number; avgMinor: number; monthlyMinor: number }

export interface SpendingDetail {
  currency: string;
  today: string;
  /** Días reales cubiertos (máx. 90). */
  periodDays: number;
  txCount: number;
  expenseMinor: number;
  monthlyExpenseMinor: number;
  categories: {
    categoryId: string; totalMinor: number; monthlyMinor: number; share: number; count: number; avgTicketMinor: number;
    prevMonthlyMinor: number; changePct: number | null; merchants: MerchantSummary[];
  }[];
  merchants: MerchantSummary[];
  recurring: { label: string; categoryId: string; monthlyMinor: number; months: number }[];
  smallFrequent: { label: string; categoryId: string; count: number; avgMinor: number; monthlyMinor: number }[];
  weekend: { share: number; totalMinor: number };
  unclassified: { totalMinor: number; count: number; pct: number; biggest: { label: string; amountMinor: number; date: string }[] };
  biggest: { label: string; amountMinor: number; date: string; categoryId: string }[];
  /** Gasto variable (sin fijos) por semana, de media. */
  variableWeeklyMinor: number;
  /** Últimos 30 días frente a la media mensual de los 60 anteriores. */
  recent: { categoryId: string; lastMonthMinor: number; priorMonthlyMinor: number }[];
}

export function buildSpendingDetail(txs: Transaction[], today: string, currency: string): SpendingDetail {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const prevFrom = addDays(today, -(2 * WINDOW_DAYS - 1));
  const exp = txs.filter((t) => t.type === 'expense' && t.date <= today);
  const cur = exp.filter((t) => t.date >= from);
  const prev = exp.filter((t) => t.date >= prevFrom && t.date < from);

  const firstDate = cur.reduce((m, t) => (t.date < m ? t.date : m), today);
  const periodDays = Math.max(14, Math.min(WINDOW_DAYS, diffDays(today, firstDate) + 1));
  const monthsEq = periodDays / 30;
  const perMonth = (n: number) => Math.round(n / monthsEq);

  // Comercios
  const byMerchant = new Map<string, MerchantAgg>();
  for (const t of cur) {
    const m = merchantKey(t.note);
    if (!m) continue;
    let a = byMerchant.get(m.key);
    if (!a) byMerchant.set(m.key, (a = { key: m.key, label: m.label, categoryVotes: new Map(), totalMinor: 0, count: 0, months: new Set(), amounts: [], labels: new Map() }));
    a.totalMinor += t.amountMinor;
    a.count += 1;
    a.months.add(t.date.slice(0, 7));
    a.amounts.push(t.amountMinor);
    a.categoryVotes.set(t.categoryId, (a.categoryVotes.get(t.categoryId) ?? 0) + 1);
    a.labels.set(m.label, (a.labels.get(m.label) ?? 0) + 1);
  }
  const topKey = (m: Map<string, number>): string => [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const summarize = (a: MerchantAgg): MerchantSummary => ({
    label: topKey(a.labels), categoryId: topKey(a.categoryVotes), totalMinor: a.totalMinor, count: a.count,
    avgMinor: Math.round(a.totalMinor / a.count), monthlyMinor: perMonth(a.totalMinor),
  });
  const merchantList = [...byMerchant.values()].map((a) => ({ a, s: summarize(a) })).sort((x, y) => y.s.totalMinor - x.s.totalMinor);

  // Categorías
  const catTotals = new Map<string, { total: number; count: number }>();
  for (const t of cur) {
    const c = catTotals.get(t.categoryId) ?? { total: 0, count: 0 };
    c.total += t.amountMinor; c.count += 1;
    catTotals.set(t.categoryId, c);
  }
  const prevByCat = new Map<string, number>();
  for (const t of prev) prevByCat.set(t.categoryId, (prevByCat.get(t.categoryId) ?? 0) + t.amountMinor);
  const hasPrev = prev.length >= 5;
  const totalExp = sum(cur.map((t) => t.amountMinor));
  const categories = [...catTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([categoryId, c]) => {
      const prevMonthly = Math.round((prevByCat.get(categoryId) ?? 0) / 3);
      return {
        categoryId, totalMinor: c.total, monthlyMinor: perMonth(c.total), share: totalExp ? c.total / totalExp : 0, count: c.count,
        avgTicketMinor: Math.round(c.total / c.count), prevMonthlyMinor: prevMonthly,
        changePct: hasPrev && prevMonthly > 0 ? Math.round(((perMonth(c.total) - prevMonthly) / prevMonthly) * 100) : null,
        merchants: merchantList.filter(({ s }) => s.categoryId === categoryId).slice(0, 4).map(({ s }) => s),
      };
    });

  // Cargos recurrentes: ≥3 meses distintos y importes muy parecidos (típico de suscripciones, seguros, cuotas).
  const recurring = merchantList
    .filter(({ a }) => a.months.size >= 3 && a.count >= 3 && a.count <= a.months.size * 2)
    .filter(({ a }) => {
      const mean = sum(a.amounts) / a.amounts.length;
      return mean > 0 && Math.sqrt(sum(a.amounts.map((x) => (x - mean) ** 2)) / a.amounts.length) / mean < 0.15;
    })
    .map(({ a, s }) => ({ label: s.label, categoryId: s.categoryId, monthlyMinor: Math.round(sum(a.amounts) / a.months.size), months: a.months.size }))
    .sort((x, y) => y.monthlyMinor - x.monthlyMinor);

  // Gastos pequeños que se repiten (no fijos): muchas veces, ticket bajo.
  const smallFrequent = merchantList
    .filter(({ a, s }) => a.count >= 8 && s.avgMinor <= 1800 && !categoryById(s.categoryId)?.fixed)
    .map(({ s }) => ({ label: s.label, categoryId: s.categoryId, count: s.count, avgMinor: s.avgMinor, monthlyMinor: s.monthlyMinor }))
    .sort((x, y) => y.monthlyMinor - x.monthlyMinor);

  // Fin de semana (vie-dom) en gastos discrecionales
  const disc = cur.filter((t) => categoryById(t.categoryId)?.discretionary && !categoryById(t.categoryId)?.fixed);
  const discTotal = sum(disc.map((t) => t.amountMinor));
  const weekendTotal = sum(disc.filter((t) => weekdayMon0(t.date) >= 4).map((t) => t.amountMinor));

  // Sin clasificar
  const other = cur.filter((t) => t.categoryId === 'other_expense');
  const otherTotal = sum(other.map((t) => t.amountMinor));
  // Sobre el gasto «del día a día» (sin fijos): si no, el alquiler diluye el porcentaje y se esconde el problema.
  const variableTotal = sum(cur.filter((t) => !categoryById(t.categoryId)?.fixed).map((t) => t.amountMinor));
  const unclassified = {
    totalMinor: otherTotal, count: other.length, pct: variableTotal ? otherTotal / variableTotal : 0,
    biggest: [...other].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 5).map((t) => ({ label: merchantKey(t.note)?.label ?? 'Sin concepto', amountMinor: t.amountMinor, date: t.date })),
  };

  // Mayores gastos variables
  const biggest = cur
    .filter((t) => !categoryById(t.categoryId)?.fixed)
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 5)
    .map((t) => ({ label: merchantKey(t.note)?.label ?? label(t.categoryId), amountMinor: t.amountMinor, date: t.date, categoryId: t.categoryId }));

  const variable = variableTotal;

  // Reciente (30 días) frente a los 60 anteriores
  const last30From = addDays(today, -29);
  const prior60From = addDays(today, -89);
  const recentMap = new Map<string, { last: number; prior: number }>();
  for (const t of cur) {
    const r = recentMap.get(t.categoryId) ?? { last: 0, prior: 0 };
    if (t.date >= last30From) r.last += t.amountMinor;
    else if (t.date >= prior60From) r.prior += t.amountMinor;
    recentMap.set(t.categoryId, r);
  }
  const recent = [...recentMap.entries()].map(([categoryId, r]) => ({ categoryId, lastMonthMinor: r.last, priorMonthlyMinor: Math.round(r.prior / 2) }));

  return {
    currency, today, periodDays, txCount: cur.length, expenseMinor: totalExp, monthlyExpenseMinor: perMonth(totalExp),
    categories, merchants: merchantList.slice(0, 15).map(({ s }) => s), recurring, smallFrequent,
    weekend: { share: discTotal ? weekendTotal / discTotal : 0, totalMinor: weekendTotal },
    unclassified, biggest, variableWeeklyMinor: Math.round(variable / (periodDays / 7)), recent,
  };
}

/** Porcentaje con la costumbre de cada idioma: «10 %» (es, de) o «10%» (en, it). */
const pct = (n: number) => (curLang() === 'en' || curLang() === 'it' ? `${Math.round(n * 100)}%` : `${Math.round(n * 100)} %`);
const names = (xs: { label: string }[], n = 3) => xs.slice(0, n).map((x) => x.label).join(', ');
const lc = (s: string) => lcName(s);

/** Mínimo de movimientos para que el análisis tenga sentido. */
export const MIN_DETAIL_TX = 15;

/** Consejos prácticos y concretos, sin IA ni envío de datos. Cada uno dice qué hacer y cuánto ahorra. */
export function detailedAdvice(d: SpendingDetail): Advice[] {
  const cur = d.currency;
  const out: Advice[] = [];
  const add = (a: Omit<Advice, 'scope'>) => out.push({ scope: 'specific', ...a });

  if (d.txCount < MIN_DETAIL_TX) {
    return [{
      id: 'd-need-data', kind: 'habit', severity: 'info', scope: 'specific',
      title: tr('Aún hay pocos movimientos para un análisis a fondo'),
      body: tr('En los últimos {days} días tengo {count} gastos. Con unos {min} o más puedo ver tus comercios, tus gastos repetidos y dónde recortar.', { days: d.periodDays, count: d.txCount, min: MIN_DETAIL_TX }),
      action: tr('Importa el extracto de tu banco (Ajustes → Importar) o anota tus gastos unos días más.'),
    }];
  }

  // 1) Las categorías que más pesan (no fijas), con comercios y ticket medio
  for (const c of d.categories.filter((x) => !categoryById(x.categoryId)?.fixed && x.categoryId !== 'other_expense').slice(0, 3)) {
    if (c.monthlyMinor < 2000 || c.count < 4) continue;
    const visitsMonth = Math.round(c.count / (d.periodDays / 30));
    const top = c.merchants.filter((m) => m.categoryId === c.categoryId);
    const cut = Math.round(c.monthlyMinor * 0.15);
    const topTxt = top.length ? ` ${tr('Lo más grande: {list}.', { list: top.slice(0, 3).map((m) => tr('{name} ({amount}/mes)', { name: m.label, amount: money(m.monthlyMinor, cur) })).join(', ') })}` : '';
    const change = c.changePct !== null && Math.abs(c.changePct) >= 15 ? ` ${c.changePct > 0 ? tr('Respecto a los 3 meses anteriores, sube un {pct} %.', { pct: Math.abs(c.changePct) }) : tr('Respecto a los 3 meses anteriores, baja un {pct} %.', { pct: Math.abs(c.changePct) })}` : '';
    let action: string;
    if (c.categoryId === 'groceries') action = tr('Haz una compra grande a la semana con lista en vez de {visits} visitas sueltas al mes (ahora {ticket} por visita). Pon un tope semanal de {cap}.', { visits: visitsMonth, ticket: money(c.avgTicketMinor, cur), cap: money(Math.round((c.monthlyMinor - cut) / 4.3), cur) });
    else if (c.categoryId === 'dining') action = tr('Fija un máximo de {max} salidas al mes (hoy {now}) y llévate comida de casa los días laborables.', { max: Math.max(2, Math.round(visitsMonth * 0.8)), now: visitsMonth });
    else if (c.categoryId === 'transport') action = tr('Compara el abono mensual con tus viajes sueltos y agrupa los trayectos; si repostas, hazlo en las gasolineras más baratas de tu ruta.');
    else if (c.categoryId === 'shopping') action = tr('Aplica la regla de las 24 horas a compras de más de {min} y deja un tope mensual de {cap}.', { min: money(2500, cur), cap: money(c.monthlyMinor - cut, cur) });
    else action = tr('Ponte un tope mensual de {cap} para {cat} y revisa a mitad de mes cómo vas.', { cap: money(c.monthlyMinor - cut, cur), cat: lc(label(c.categoryId)) });
    add({
      id: `d-cat-${c.categoryId}`, kind: 'spending', severity: c.share > 0.25 ? 'warn' : 'tip', impactMinor: cut,
      title: tr('{cat}: {amount} al mes ({pct} de tus gastos)', { cat: label(c.categoryId), amount: money(c.monthlyMinor, cur), pct: pct(c.share) }),
      body: `${tr('Has hecho {n} pagos al mes, de {avg} de media.', { n: visitsMonth, avg: money(c.avgTicketMinor, cur) })}${topTxt}${change}`,
      action,
    });
  }

  // 2) Gastos pequeños que se repiten
  if (d.smallFrequent.length) {
    const total = sum(d.smallFrequent.slice(0, 4).map((s) => s.monthlyMinor));
    if (total >= 1500) {
      const s0 = d.smallFrequent[0]!;
      add({
        id: 'd-small', kind: 'spending', severity: 'tip', impactMinor: Math.round(total * 0.4),
        title: tr('Pequeños gastos que suman {amount} al mes', { amount: money(total, cur) }),
        body: tr('{names}: compras de unos {avg} que repites ({top}: {count} veces en {days} días). Cada una parece poco, pero juntas pesan.', { names: names(d.smallFrequent, 4), avg: money(s0.avgMinor, cur), top: s0.label, count: s0.count, days: d.periodDays }),
        action: tr('Quédate con la mitad de esas visitas: ahorrarías unos {save} al mes. Prueba una semana sin {top}.', { save: money(Math.round(total * 0.4), cur), top: s0.label }),
      });
    }
  }

  // 3) Cargos recurrentes
  if (d.recurring.length >= 2) {
    const total = sum(d.recurring.map((r) => r.monthlyMinor));
    const subs = d.recurring.filter((r) => r.categoryId === 'subscriptions');
    add({
      id: 'd-recurring', kind: 'saving', severity: 'tip', impactMinor: Math.round((subs.length ? sum(subs.map((s) => s.monthlyMinor)) : total * 0.1) * 0.3),
      title: tr('{n} cargos fijos se repiten cada mes: {amount}', { n: d.recurring.length, amount: money(total, cur) }),
      body: tr('Los más grandes: {list}.', { list: d.recurring.slice(0, 4).map((r) => `${r.label} (${money(r.monthlyMinor, cur)})`).join(', ') }),
      action: tr('Revisa uno por uno: ¿lo usaste este mes? Cancela lo que no, y para seguros, luz o móvil pide ofertas competidoras: suelen bajar la cuota.'),
    });
  }

  // 4) Lo que ha subido en el último mes
  const risers = d.recent
    .filter((r) => !categoryById(r.categoryId)?.fixed && r.categoryId !== 'other_expense' && r.priorMonthlyMinor > 0 && r.lastMonthMinor > r.priorMonthlyMinor * 1.3 && r.lastMonthMinor - r.priorMonthlyMinor >= 3000)
    .sort((a, b) => b.lastMonthMinor - b.priorMonthlyMinor - (a.lastMonthMinor - a.priorMonthlyMinor));
  if (risers[0]) {
    const r = risers[0];
    const diff = r.lastMonthMinor - r.priorMonthlyMinor;
    add({
      id: `d-rise-${r.categoryId}`, kind: 'spending', severity: 'warn', impactMinor: diff,
      title: tr('{cat} ha subido {diff} en el último mes', { cat: label(r.categoryId), diff: money(diff, cur) }),
      body: tr('En los últimos 30 días gastaste {last} frente a {prior} de media al mes antes.', { last: money(r.lastMonthMinor, cur), prior: money(r.priorMonthlyMinor, cur) }),
      action: tr('Mira los movimientos de {cat} de este mes: si fue algo puntual, no hagas nada; si es nuevo hábito, ponle tope.', { cat: lc(label(r.categoryId)) }),
    });
  }

  // 5) Fin de semana
  if (d.weekend.share >= 0.6 && d.weekend.totalMinor >= 6000) {
    const cut = Math.round((d.weekend.totalMinor / (d.periodDays / 30)) * 0.2);
    add({
      id: 'd-weekend', kind: 'habit', severity: 'info', impactMinor: cut,
      title: tr('El {pct} de tu ocio y restaurantes cae de viernes a domingo', { pct: pct(d.weekend.share) }),
      body: tr('Eso son {amount} al mes en tres días.', { amount: money(Math.round(d.weekend.totalMinor / (d.periodDays / 30)), cur) }),
      action: tr('Pon un presupuesto de fin de semana (por ejemplo {cap} por semana) y sácalo en efectivo o a una tarjeta aparte.', { cap: money(Math.round((d.weekend.totalMinor / (d.periodDays / 30)) * 0.8 / 4.3), cur) }),
    });
  }

  // 6) Sin clasificar
  if (d.unclassified.pct >= 0.10 && d.unclassified.count >= 5) {
    const b = d.unclassified.biggest.slice(0, 3).map((x) => `${x.label} (${money(x.amountMinor, cur)})`).join(', ');
    add({
      id: 'd-unclassified', kind: 'habit', severity: 'info',
      title: tr('{pct} de tus gastos del día a día está en «Otros»', { pct: pct(d.unclassified.pct) }),
      body: tr('Son {count} movimientos por {total}. Mientras estén sin clasificar, no puedo decirte dónde recortar. Los más grandes: {list}.', { count: d.unclassified.count, total: money(d.unclassified.totalMinor, cur), list: b }),
      action: tr('Abre Movimientos, filtra «Otros gastos» y cambia la categoría de los más grandes: la próxima importación recordará tus elecciones.'),
    });
  }

  // 7) Tope semanal
  if (d.variableWeeklyMinor >= 3000) {
    const target = Math.round(d.variableWeeklyMinor * 0.9);
    add({
      id: 'd-weekly-cap', kind: 'saving', severity: 'tip', impactMinor: Math.round((d.variableWeeklyMinor - target) * 4.3),
      title: tr('Tu gasto variable es de {amount} a la semana', { amount: money(d.variableWeeklyMinor, cur) }),
      body: tr('Es lo que gastas sin contar vivienda, suministros, seguros ni deudas, que es donde de verdad puedes decidir.'),
      action: tr('Prueba con un tope de {cap} por semana (un 10 % menos). Mira el viernes cuánto te queda y ajusta el fin de semana.', { cap: money(target, cur) }),
    });
  }

  // 8) Reconocimiento
  const down = d.categories.find((c) => !categoryById(c.categoryId)?.fixed && c.changePct !== null && c.changePct <= -20 && c.prevMonthlyMinor - c.monthlyMinor >= 2000);
  if (down) {
    add({
      id: `d-win-${down.categoryId}`, kind: 'win', severity: 'win', impactMinor: down.prevMonthlyMinor - down.monthlyMinor,
      title: tr('Has reducido {cat} un {pct} %', { cat: lc(label(down.categoryId)), pct: Math.abs(down.changePct!) }),
      body: tr('Pasaste de {from} a {to} al mes frente a los 3 meses anteriores.', { from: money(down.prevMonthlyMinor, cur), to: money(down.monthlyMinor, cur) }),
      action: tr('Lo que has hecho funciona: mantenlo y, si puedes, mueve esa diferencia a ahorro el mismo día que cobras.'),
    });
  }

  const ORDER = { warn: 0, tip: 1, info: 2, win: 3 } as const;
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.impactMinor ?? 0) - (a.impactMinor ?? 0)).slice(0, 9);
}

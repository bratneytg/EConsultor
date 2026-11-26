import { categoryById, type Advice, type Overview } from '@econsultor/shared';
import { curLang, lcName, localeOf, tr } from '../../lib/i18n.js';
import type { FinancialProfile } from '../profile/engine.js';

export function money(minor: number, currency: string): string {
  return (minor / 100).toLocaleString(localeOf(curLang()), { style: 'currency', currency, maximumFractionDigits: 0 });
}

const label = (id: string): string => tr(categoryById(id)?.label ?? id);
const pctOf = (x: number): string => (x * 100).toFixed(0);

const ORDER: Record<Advice['severity'], number> = { warn: 0, tip: 1, win: 2, info: 3 };

/**
 * Asesor determinista: funciona sin conexión, sin coste y sin enviar datos a terceros.
 * Combina consejos ESPECÍFICOS (derivados del perfil y del mes) y GENÉRICOS (buenas prácticas).
 */
export function ruleBasedAdvice(p: FinancialProfile, o: Overview): Advice[] {
  const cur = o.currency;
  const out: Advice[] = [];
  const add = (a: Advice) => out.push(a);

  const hasData = p.monthsOfData > 0 || o.totals.expenseMinor > 0;

  if (!hasData) {
    add({
      id: 'start-logging', kind: 'habit', severity: 'info', scope: 'generic',
      title: tr('Empieza por registrar una semana'),
      body: tr('Anota cada gasto e ingreso durante 7 días. Con eso ya podemos dibujar tus gráficas y empezar a darte consejos a medida.'),
    });
    return out;
  }

  // ── Específicos ──
  if (p.avgIncomeMinor > 0 && p.savingsRate < 0) {
    const deficit = p.avgExpenseMinor - p.avgIncomeMinor;
    add({
      id: 'deficit', kind: 'risk', severity: 'warn', scope: 'specific', impactMinor: deficit,
      title: tr('Gastas más de lo que ingresas'),
      body: tr('De media gastas {amount} más al mes de lo que entra. Prioriza recortar la categoría más grande de gasto variable y evita financiarlo con deuda.', { amount: money(deficit, cur) }),
    });
  } else if (p.avgIncomeMinor > 0 && p.savingsRate < 0.1) {
    const target = Math.round(p.avgIncomeMinor * 0.1) - Math.round(p.avgIncomeMinor * Math.max(0, p.savingsRate));
    add({
      id: 'save-10', kind: 'saving', severity: 'tip', scope: 'specific', impactMinor: target,
      title: tr('Primer objetivo: ahorrar el 10 %'),
      body: tr('Ahora ahorras un {pct} % de tus ingresos. Subir al 10 % supone apartar {amount} más al mes. Hazlo con una transferencia automática el día de cobro.', { pct: pctOf(Math.max(0, p.savingsRate)), amount: money(target, cur) }),
    });
  }

  if (o.forecast.projectedNetMinor < 0 && o.forecast.daysElapsed >= 5 && o.forecast.daysElapsed < o.forecast.daysInMonth) {
    add({
      id: 'forecast-negative', kind: 'risk', severity: 'warn', scope: 'specific', impactMinor: -o.forecast.projectedNetMinor,
      title: tr('A este ritmo cerrarás el mes en negativo'),
      body: tr('Tu previsión es terminar el mes con {net}. Tu gasto variable ronda {daily} al día; reducirlo un 15 % lo corregiría.', { net: money(o.forecast.projectedNetMinor, cur), daily: money(o.forecast.dailyRunRateMinor, cur) }),
    });
  }

  if (p.discretionaryShare > 0.35) {
    const top = p.topCategories.find((c) => categoryById(c.categoryId)?.discretionary);
    const save = Math.round(p.avgDiscretionaryMinor * 0.15);
    add({
      id: 'discretionary-high', kind: 'spending', severity: 'tip', scope: 'specific', impactMinor: save,
      title: tr('El gasto discrecional pesa mucho'),
      body: top
        ? tr('El {pct} % de tus gastos es prescindible (sobre todo {cat}). Recortar un 15 % liberaría unos {amount} al mes sin tocar lo esencial.', { pct: pctOf(p.discretionaryShare), cat: lcName(label(top.categoryId)), amount: money(save, cur) })
        : tr('El {pct} % de tus gastos es prescindible. Recortar un 15 % liberaría unos {amount} al mes sin tocar lo esencial.', { pct: pctOf(p.discretionaryShare), amount: money(save, cur) }),
    });
  }

  if (p.subscriptionsMinor >= 3500 || (p.avgIncomeMinor > 0 && p.subscriptionsMinor / p.avgIncomeMinor > 0.04)) {
    add({
      id: 'subscriptions', kind: 'spending', severity: 'tip', scope: 'specific', impactMinor: Math.round(p.subscriptionsMinor * 0.3),
      title: tr('Revisa tus suscripciones'),
      body: tr('Pagas de media {amount} al mes en suscripciones. Cancelar o pausar las que menos usas suele ahorrar un tercio.', { amount: money(p.subscriptionsMinor, cur) }),
    });
  }

  for (const c of o.expenseByCategory.slice(0, 6)) {
    if (c.prevAmountMinor > 0 && c.amountMinor > c.prevAmountMinor * 1.3 && c.amountMinor - c.prevAmountMinor > 3000 && !categoryById(c.categoryId)?.fixed) {
      const diff = c.amountMinor - c.prevAmountMinor;
      add({
        id: `jump-${c.categoryId}`, kind: 'spending', severity: 'warn', scope: 'specific', impactMinor: diff,
        title: tr('{cat} se ha disparado', { cat: label(c.categoryId) }),
        body: tr('Este mes llevas {amount} en {cat}, {diff} más que el mes pasado. ¿Fue algo puntual o se está volviendo costumbre?', { amount: money(c.amountMinor, cur), cat: lcName(label(c.categoryId)), diff: money(diff, cur) }),
      });
      break;
    }
  }

  if (p.weekendBias > 1.7) {
    add({
      id: 'weekend', kind: 'habit', severity: 'info', scope: 'specific',
      title: tr('Tus fines de semana son caros'),
      body: tr('Gastas {n}× más al día en fin de semana que entre semana. Un presupuesto semanal para ocio (en efectivo o en una tarjeta aparte) suele moderarlo.', { n: p.weekendBias.toFixed(1) }),
    });
  }

  if (p.incomeCV > 0.3 || p.archetype === 'irregular') {
    const buffer = p.avgFixedMinor * 3;
    add({
      id: 'irregular-income', kind: 'risk', severity: 'tip', scope: 'specific', impactMinor: buffer,
      title: tr('Ingresos irregulares: crea un colchón'),
      body: tr('Tus ingresos varían bastante de un mes a otro. Un fondo de {amount} (3 meses de gastos fijos) te da tranquilidad en los meses flojos.', { amount: money(buffer, cur) }),
    });
  }

  if (p.avgExpenseMinor > 0) {
    const target = p.avgExpenseMinor * 3;
    add({
      id: 'emergency-fund', kind: 'saving', severity: 'info', scope: 'specific', impactMinor: target,
      title: tr('Tu fondo de emergencia ideal'),
      body: tr('Con tu nivel de gasto, un fondo de emergencia de entre {min} y {max} (3–6 meses) cubriría casi cualquier imprevisto.', { min: money(p.avgExpenseMinor * 3, cur), max: money(p.avgExpenseMinor * 6, cur) }),
    });
  }

  if (p.incomeSources === 1 && p.avgIncomeMinor > 0) {
    add({
      id: 'diversify-income', kind: 'income', severity: 'info', scope: 'specific',
      title: tr('Una sola fuente de ingresos'),
      body: tr('Dependes de una única fuente. Un ingreso extra pequeño (horas extra, venta de objetos que no usas, un servicio puntual) reduce el riesgo y acelera tus objetivos de ahorro.'),
    });
  }

  if (p.loggingConsistency < 0.5) {
    add({
      id: 'logging', kind: 'habit', severity: 'tip', scope: 'specific',
      title: tr('La constancia es la clave'),
      body: tr('Has registrado menos de la mitad de los últimos 30 días. Activa el recordatorio diario: con datos completos tus gráficas y consejos serán mucho más precisos.'),
    });
  }

  // ── Logros ──
  if (o.streakDays >= 7) {
    add({ id: 'streak', kind: 'win', severity: 'win', scope: 'specific', title: tr('¡{n} días seguidos registrando!', { n: o.streakDays }), body: tr('Esa constancia es lo que separa a quien controla su dinero de quien lo intuye. Sigue así.') });
  }
  if (p.savingsRate >= 0.2) {
    add({ id: 'saver', kind: 'win', severity: 'win', scope: 'specific', title: tr('Ahorras más del 20 %'), body: tr('Ahorras un {pct} % de tus ingresos: por encima de la regla clásica 50/30/20. Plantéate dirigir el excedente a un fondo indexado de bajo coste una vez cubierto tu colchón.', { pct: pctOf(p.savingsRate) }) });
  }
  if (p.expenseTrend === 'falling') {
    add({ id: 'trend-down', kind: 'win', severity: 'win', scope: 'specific', title: tr('Tus gastos van a la baja'), body: tr('El último mes completo gastaste menos que tu media anterior. Mantén lo que estés haciendo.') });
  } else if (p.expenseTrend === 'rising') {
    add({ id: 'trend-up', kind: 'spending', severity: 'tip', scope: 'specific', title: tr('Tus gastos suben mes a mes'), body: tr('El último mes completo gastaste más que tu media previa. Revisa en el Resumen qué categorías han crecido.') });
  }

  // ── Genéricos (buenas prácticas) ──
  add({ id: 'g-503020', kind: 'saving', severity: 'info', scope: 'generic', title: tr('La regla 50/30/20'), body: tr('Destina ~50 % a necesidades, ~30 % a deseos y ~20 % a ahorro y deudas. Es un punto de partida, no un dogma: ajústalo a tu realidad.') });
  add({ id: 'g-autopay', kind: 'saving', severity: 'info', scope: 'generic', title: tr('Págate a ti primero'), body: tr('Programa una transferencia automática a tu cuenta de ahorro el día que cobras. Lo que no ves, no lo gastas.') });
  add({ id: 'g-24h', kind: 'spending', severity: 'info', scope: 'generic', title: tr('La regla de las 24 horas'), body: tr('Para compras no esenciales, espera un día. Muchas ganas desaparecen solas.') });
  add({ id: 'g-insurance', kind: 'spending', severity: 'info', scope: 'generic', title: tr('Compara seguros y tarifas una vez al año'), body: tr('Luz, internet, móvil y seguros suelen tener mejores ofertas para clientes nuevos. Un rato de comparación puede ahorrar cientos de euros al año.') });
  add({ id: 'g-debt', kind: 'risk', severity: 'info', scope: 'generic', title: tr('Deuda cara primero'), body: tr('Si tienes deudas con intereses altos (tarjetas, créditos rápidos), amortizarlas suele rendir más que cualquier inversión.') });

  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'specific' ? -1 : 1) || ORDER[a.severity] - ORDER[b.severity]);
}

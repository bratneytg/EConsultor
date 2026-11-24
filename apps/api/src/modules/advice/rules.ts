import { categoryById, type Advice, type Overview } from '@econsultor/shared';
import type { FinancialProfile } from '../profile/engine.js';

export function money(minor: number, currency: string): string {
  return (minor / 100).toLocaleString('es-ES', { style: 'currency', currency, maximumFractionDigits: 0 });
}

const label = (id: string): string => categoryById(id)?.label ?? id;

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
      title: 'Empieza por registrar una semana',
      body: 'Anota cada gasto e ingreso durante 7 días. Con eso ya podemos dibujar tus gráficas y empezar a darte consejos a medida.',
    });
    return out;
  }

  // ── Específicos ──
  if (p.avgIncomeMinor > 0 && p.savingsRate < 0) {
    const deficit = p.avgExpenseMinor - p.avgIncomeMinor;
    add({
      id: 'deficit', kind: 'risk', severity: 'warn', scope: 'specific', impactMinor: deficit,
      title: 'Gastas más de lo que ingresas',
      body: `De media gastas ${money(deficit, cur)} más al mes de lo que entra. Prioriza recortar la categoría más grande de gasto variable y evita financiarlo con deuda.`,
    });
  } else if (p.avgIncomeMinor > 0 && p.savingsRate < 0.1) {
    const target = Math.round(p.avgIncomeMinor * 0.1) - Math.round(p.avgIncomeMinor * Math.max(0, p.savingsRate));
    add({
      id: 'save-10', kind: 'saving', severity: 'tip', scope: 'specific', impactMinor: target,
      title: 'Primer objetivo: ahorrar el 10 %',
      body: `Ahora ahorras un ${(Math.max(0, p.savingsRate) * 100).toFixed(0)} % de tus ingresos. Subir al 10 % supone apartar ${money(target, cur)} más al mes. Hazlo con una transferencia automática el día de cobro.`,
    });
  }

  if (o.forecast.projectedNetMinor < 0 && o.forecast.daysElapsed >= 5 && o.forecast.daysElapsed < o.forecast.daysInMonth) {
    add({
      id: 'forecast-negative', kind: 'risk', severity: 'warn', scope: 'specific', impactMinor: -o.forecast.projectedNetMinor,
      title: 'A este ritmo cerrarás el mes en negativo',
      body: `Tu previsión es terminar el mes con ${money(o.forecast.projectedNetMinor, cur)}. Tu gasto variable ronda ${money(o.forecast.dailyRunRateMinor, cur)} al día; reducirlo un 15 % lo corregiría.`,
    });
  }

  if (p.discretionaryShare > 0.35) {
    const top = p.topCategories.find((c) => categoryById(c.categoryId)?.discretionary);
    const save = Math.round(p.avgDiscretionaryMinor * 0.15);
    add({
      id: 'discretionary-high', kind: 'spending', severity: 'tip', scope: 'specific', impactMinor: save,
      title: 'El gasto discrecional pesa mucho',
      body: `El ${(p.discretionaryShare * 100).toFixed(0)} % de tus gastos es prescindible${top ? ` (sobre todo ${label(top.categoryId).toLowerCase()})` : ''}. Recortar un 15 % liberaría unos ${money(save, cur)} al mes sin tocar lo esencial.`,
    });
  }

  if (p.subscriptionsMinor >= 3500 || (p.avgIncomeMinor > 0 && p.subscriptionsMinor / p.avgIncomeMinor > 0.04)) {
    add({
      id: 'subscriptions', kind: 'spending', severity: 'tip', scope: 'specific', impactMinor: Math.round(p.subscriptionsMinor * 0.3),
      title: 'Revisa tus suscripciones',
      body: `Pagas de media ${money(p.subscriptionsMinor, cur)} al mes en suscripciones. Cancelar o pausar las que menos usas suele ahorrar un tercio.`,
    });
  }

  for (const c of o.expenseByCategory.slice(0, 6)) {
    if (c.prevAmountMinor > 0 && c.amountMinor > c.prevAmountMinor * 1.3 && c.amountMinor - c.prevAmountMinor > 3000 && !categoryById(c.categoryId)?.fixed) {
      const diff = c.amountMinor - c.prevAmountMinor;
      add({
        id: `jump-${c.categoryId}`, kind: 'spending', severity: 'warn', scope: 'specific', impactMinor: diff,
        title: `${label(c.categoryId)} se ha disparado`,
        body: `Este mes llevas ${money(c.amountMinor, cur)} en ${label(c.categoryId).toLowerCase()}, ${money(diff, cur)} más que el mes pasado. ¿Fue algo puntual o se está volviendo costumbre?`,
      });
      break;
    }
  }

  if (p.weekendBias > 1.7) {
    add({
      id: 'weekend', kind: 'habit', severity: 'info', scope: 'specific',
      title: 'Tus fines de semana son caros',
      body: `Gastas ${p.weekendBias.toFixed(1)}× más al día en fin de semana que entre semana. Un presupuesto semanal para ocio (en efectivo o en una tarjeta aparte) suele moderarlo.`,
    });
  }

  if (p.incomeCV > 0.3 || p.archetype === 'irregular') {
    const buffer = p.avgFixedMinor * 3;
    add({
      id: 'irregular-income', kind: 'risk', severity: 'tip', scope: 'specific', impactMinor: buffer,
      title: 'Ingresos irregulares: crea un colchón',
      body: `Tus ingresos varían bastante de un mes a otro. Un fondo de ${money(buffer, cur)} (3 meses de gastos fijos) te da tranquilidad en los meses flojos.`,
    });
  }

  if (p.avgExpenseMinor > 0) {
    const target = p.avgExpenseMinor * 3;
    add({
      id: 'emergency-fund', kind: 'saving', severity: 'info', scope: 'specific', impactMinor: target,
      title: 'Tu fondo de emergencia ideal',
      body: `Con tu nivel de gasto, un fondo de emergencia de entre ${money(p.avgExpenseMinor * 3, cur)} y ${money(p.avgExpenseMinor * 6, cur)} (3–6 meses) cubriría casi cualquier imprevisto.`,
    });
  }

  if (p.incomeSources === 1 && p.avgIncomeMinor > 0) {
    add({
      id: 'diversify-income', kind: 'income', severity: 'info', scope: 'specific',
      title: 'Una sola fuente de ingresos',
      body: 'Dependes de una única fuente. Un ingreso extra pequeño (horas extra, venta de objetos que no usas, un servicio puntual) reduce el riesgo y acelera tus objetivos de ahorro.',
    });
  }

  if (p.loggingConsistency < 0.5) {
    add({
      id: 'logging', kind: 'habit', severity: 'tip', scope: 'specific',
      title: 'La constancia es la clave',
      body: 'Has registrado menos de la mitad de los últimos 30 días. Activa el recordatorio diario: con datos completos tus gráficas y consejos serán mucho más precisos.',
    });
  }

  // ── Logros ──
  if (o.streakDays >= 7) {
    add({ id: 'streak', kind: 'win', severity: 'win', scope: 'specific', title: `¡${o.streakDays} días seguidos registrando!`, body: 'Esa constancia es lo que separa a quien controla su dinero de quien lo intuye. Sigue así.' });
  }
  if (p.savingsRate >= 0.2) {
    add({ id: 'saver', kind: 'win', severity: 'win', scope: 'specific', title: 'Ahorras más del 20 %', body: `Ahorras un ${(p.savingsRate * 100).toFixed(0)} % de tus ingresos: por encima de la regla clásica 50/30/20. Plantéate dirigir el excedente a un fondo indexado de bajo coste una vez cubierto tu colchón.` });
  }
  if (p.expenseTrend === 'falling') {
    add({ id: 'trend-down', kind: 'win', severity: 'win', scope: 'specific', title: 'Tus gastos van a la baja', body: 'El último mes completo gastaste menos que tu media anterior. Mantén lo que estés haciendo.' });
  } else if (p.expenseTrend === 'rising') {
    add({ id: 'trend-up', kind: 'spending', severity: 'tip', scope: 'specific', title: 'Tus gastos suben mes a mes', body: 'El último mes completo gastaste más que tu media previa. Revisa en Estadísticas qué categorías han crecido.' });
  }

  // ── Genéricos (buenas prácticas) ──
  add({ id: 'g-503020', kind: 'saving', severity: 'info', scope: 'generic', title: 'La regla 50/30/20', body: 'Destina ~50 % a necesidades, ~30 % a deseos y ~20 % a ahorro y deudas. Es un punto de partida, no un dogma: ajústalo a tu realidad.' });
  add({ id: 'g-autopay', kind: 'saving', severity: 'info', scope: 'generic', title: 'Págate a ti primero', body: 'Programa una transferencia automática a tu cuenta de ahorro el día que cobras. Lo que no ves, no lo gastas.' });
  add({ id: 'g-24h', kind: 'spending', severity: 'info', scope: 'generic', title: 'La regla de las 24 horas', body: 'Para compras no esenciales, espera un día. Muchas ganas desaparecen solas.' });
  add({ id: 'g-insurance', kind: 'spending', severity: 'info', scope: 'generic', title: 'Compara seguros y tarifas una vez al año', body: 'Luz, internet, móvil y seguros suelen tener mejores ofertas para clientes nuevos. Un rato de comparación puede ahorrar cientos de euros al año.' });
  add({ id: 'g-debt', kind: 'risk', severity: 'info', scope: 'generic', title: 'Deuda cara primero', body: 'Si tienes deudas con intereses altos (tarjetas, créditos rápidos), amortizarlas suele rendir más que cualquier inversión.' });

  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'specific' ? -1 : 1) || ORDER[a.severity] - ORDER[b.severity]);
}

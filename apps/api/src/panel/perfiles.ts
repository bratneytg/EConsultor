/**
 * Perfiles financieros para el panel de administración (opt-in: PANEL_VER_PERFILES=true).
 *
 * Reutiliza el motor interno `buildFinancialProfile` y la previsión de `buildOverview`, los mismos
 * que usan los consejos. Es una excepción deliberada y documentada a la regla de que el perfil nunca
 * sale del servidor por la API: aquí lo lee un proceso aparte, solo desde la red privada y solo si la
 * persona que administra lo activa expresamente. Ver docs/SECURITY.md.
 */
import { categoryById, type Transaction } from '@econsultor/shared';
import { monthOf, todayIn } from '../lib/dates.js';
import { buildOverview, streakDays } from '../modules/analytics/analytics.js';
import { buildFinancialProfile, type FinancialProfile } from '../modules/profile/engine.js';
import type { UserRecord } from '../store/types.js';
import { construirPsico } from './psico.js';

type Libre = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type TxPanel = Omit<Transaction, 'updatedAt' | 'currency'> & { userId: string; currency?: string; updatedAt?: string };

export const ETIQUETA_ARQUETIPO: Record<FinancialProfile['archetype'], { nombre: string; descripcion: string }> = {
  saver: { nombre: 'Ahorrador', descripcion: 'Ahorra con holgura (25 % o más de lo que ingresa).' },
  balanced: { nombre: 'Equilibrado', descripcion: 'Ahorra entre el 10 % y el 25 %.' },
  tight: { nombre: 'Ajustado', descripcion: 'Llega a fin de mes, pero ahorra menos del 10 %.' },
  overspender: { nombre: 'Gasta de más', descripcion: 'Gasta más de lo que ingresa de forma habitual.' },
  irregular: { nombre: 'Ingresos irregulares', descripcion: 'Sus ingresos varían mucho de un mes a otro.' },
};
const TENDENCIA = { rising: 'subiendo', flat: 'estable', falling: 'bajando' } as const;

const redondea = (n: number, d = 2): number => Number(n.toFixed(d));
const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Frases cortas que explican el perfil con palabras, para leerlo sin interpretar números. */
function lecturas(p: FinancialProfile, racha: number): string[] {
  const out: string[] = [];
  const ahorro = Math.round(p.savingsRate * 100);
  if (p.savingsRate < 0) out.push(`Gasta más de lo que ingresa (${ahorro} %).`);
  else out.push(`Ahorra de media el ${ahorro} % de sus ingresos.`);
  if (p.fixedRatio > 0.55) out.push(`Los gastos fijos pesan mucho: el ${Math.round(p.fixedRatio * 100)} % de sus ingresos.`);
  if (p.incomeCV > 0.35) out.push('Sus ingresos son poco predecibles; le conviene un colchón mayor.');
  if (p.expenseTrend === 'rising') out.push('El gasto del último mes va al alza respecto a sus meses anteriores.');
  if (p.expenseTrend === 'falling') out.push('Está reduciendo su gasto respecto a meses anteriores.');
  if (p.weekendBias > 1.5) out.push('Gasta bastante más los fines de semana que entre semana.');
  if (p.subscriptionsMinor > 0 && p.avgIncomeMinor > 0 && p.subscriptionsMinor / p.avgIncomeMinor > 0.05) out.push('Las suscripciones superan el 5 % de sus ingresos.');
  if (p.loggingConsistency < 0.3) out.push('Anota poco: sus datos pueden no reflejar todo su gasto.');
  else if (racha >= 7) out.push(`Constante: lleva ${racha} días seguidos anotando.`);
  return out;
}

export function construirPerfiles(users: UserRecord[], txs: TxPanel[], ahora: number, conPsico = false): Libre {
  const porUsuario = new Map<string, Transaction[]>();
  for (const { userId, ...t } of txs) (porUsuario.get(userId) ?? porUsuario.set(userId, []).get(userId)!).push(t as Transaction);

  const perfiles: Libre[] = [];
  const sinDatos: { email: string; movimientos: number }[] = [];
  for (const u of users) {
    const lista = porUsuario.get(u.id) ?? [];
    // Con menos de 5 movimientos un perfil sería ruido: se avisa en vez de inventarlo.
    if (lista.length < 5) { sinDatos.push({ email: u.email, movimientos: lista.length }); continue; }
    const hoy = todayIn(u.timezone, new Date(ahora));
    const p = buildFinancialProfile(lista, hoy);
    const ov = buildOverview(lista, { month: monthOf(hoy), today: hoy, currency: u.currency });
    const racha = streakDays(lista, hoy);
    perfiles.push({
      email: u.email,
      nombre: u.displayName,
      moneda: u.currency,
      plan: u.plan,
      movimientos: lista.length,
      meses: p.monthsOfData,
      // Con 1 mes los promedios son frágiles; se marca para no sobreinterpretar.
      fiabilidad: p.monthsOfData >= 3 ? 'alta' : p.monthsOfData === 2 ? 'media' : 'baja',
      arquetipo: p.archetype,
      arquetipoNombre: ETIQUETA_ARQUETIPO[p.archetype].nombre,
      arquetipoDescripcion: ETIQUETA_ARQUETIPO[p.archetype].descripcion,
      riesgo: p.riskScore,
      salud: { puntos: ov.health.score, etiqueta: ov.health.label, partes: ov.health.parts.map((x) => ({ clave: x.key, nombre: x.label, valor: x.value, peso: x.weight })) },
      ahorroPct: Math.round(p.savingsRate * 100),
      ingresoMedio: p.avgIncomeMinor,
      gastoMedio: p.avgExpenseMinor,
      fijosPct: Math.round(p.fixedRatio * 100),
      discrecionalPct: Math.round(p.discretionaryShare * 100),
      volatilidadIngresos: redondea(p.incomeCV),
      volatilidadGasto: redondea(p.expenseCV),
      tendenciaGasto: TENDENCIA[p.expenseTrend],
      tendencia: p.expenseTrend,
      fuentesIngreso: p.incomeSources,
      suscripciones: p.subscriptionsMinor,
      sesgoFinDeSemana: redondea(p.weekendBias),
      constanciaPct: Math.round(p.loggingConsistency * 100),
      racha,
      categorias: p.topCategories.map((c) => ({ id: c.categoryId, nombre: categoryById(c.categoryId)?.label ?? c.categoryId, pct: Math.round(c.share * 100), medio: c.avgMinor })),
      mesActual: { ingresos: ov.totals.incomeMinor, gastos: ov.totals.expenseMinor, neto: ov.totals.netMinor },
      prevision: {
        diasTranscurridos: ov.forecast.daysElapsed,
        diasMes: ov.forecast.daysInMonth,
        ritmoDiario: ov.forecast.dailyRunRateMinor,
        gastoProyectado: ov.forecast.projectedExpenseMinor,
        cierreProyectado: ov.forecast.projectedNetMinor,
      },
      meses12: ov.monthly.map((m) => ({ mes: m.month, ingresos: m.incomeMinor, gastos: m.expenseMinor })),
      lecturas: lecturas(p, racha),
      // Evaluación psico-económica: sólo si se pidió expresamente (PANEL_VER_PSICO) y nunca por la API de la app.
      ...(conPsico ? { psico: construirPsico(lista, p, hoy) } : {}),
    });
  }

  perfiles.sort((a, b) => b.riesgo - a.riesgo);

  // Visión de conjunto: solo con personas que tienen perfil.
  const porArquetipo = Object.entries(ETIQUETA_ARQUETIPO).map(([clave, v]) => ({
    clave,
    nombre: v.nombre,
    n: perfiles.filter((p) => p.arquetipo === clave).length,
  }));
  const catAgregada = new Map<string, { nombre: string; suma: number; n: number }>();
  for (const p of perfiles) for (const c of p.categorias as { id: string; nombre: string; pct: number }[]) {
    const a = catAgregada.get(c.id) ?? { nombre: c.nombre, suma: 0, n: 0 };
    a.suma += c.pct; a.n++;
    catAgregada.set(c.id, a);
  }
  const ahorros = perfiles.map((p) => p.ahorroPct as number);
  const conjunto = {
    conPerfil: perfiles.length,
    sinDatosSuficientes: sinDatos.length,
    porArquetipo,
    ahorroMedianoPct: mediana(ahorros),
    riesgoMedio: perfiles.length ? Math.round(perfiles.reduce((s, p) => s + p.riesgo, 0) / perfiles.length) : null,
    enRiesgoAlto: perfiles.filter((p) => p.riesgo >= 60).length,
    gastanDeMas: perfiles.filter((p) => p.ahorroPct < 0).length,
    categoriasFrecuentes: [...catAgregada].map(([id, v]) => ({ id, nombre: v.nombre, usuarios: v.n, pctMedio: Math.round(v.suma / v.n) })).sort((a, b) => b.usuarios - a.usuarios || b.pctMedio - a.pctMedio).slice(0, 6),
    ahorroPorPersona: perfiles.map((p) => ({ email: p.email, pct: p.ahorroPct, riesgo: p.riesgo })),
  };

  return { activo: true, perfiles, sinDatos, conjunto };
}

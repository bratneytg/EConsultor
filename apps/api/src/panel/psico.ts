/**
 * Evaluación psico-económica (SOLO panel del servidor, opt-in: PANEL_VER_PSICO=true).
 *
 * Qué es: una lectura de comportamiento a partir de lo que una persona ingresa y gasta, apoyada en marcos
 * de la psicología del dinero con respaldo empírico. Qué NO es: un test psicológico ni un diagnóstico. Los
 * cuestionarios originales miden creencias; aquí sólo hay conducta observada, así que cada rasgo lleva su
 * evidencia y su nivel de confianza, y cuando el gasto está dominado por obligaciones se avisa de que lo
 * que se ve es restricción, no carácter.
 *
 * Marcos usados (adaptados a datos de transacciones):
 *  - Money Scripts (Klontz y Britt, 2011): evitación, adoración, estatus y vigilancia del dinero.
 *  - Tightwad–Spendthrift (Rick, Cryder y Loewenstein, 2008): el «dolor de pagar» como dimensión de personalidad.
 *  - Sesgo hacia el presente / descuento hiperbólico (Laibson, 1997) y perspectiva temporal (Zimbardo y Boyd, 1999).
 *  - Enfoque regulatorio (Higgins, 1997): prevención (seguridad) frente a promoción (crecimiento).
 *  - Gasto experiencial frente a material (Van Boven y Gilovich, 2003) y gasto prosocial (Dunn, Aknin y Norton, 2008).
 *  - Propensión marginal a consumir (Keynes) e hipótesis del ingreso permanente (Friedman): inflación del estilo de vida.
 *  - Contabilidad mental y «efecto día de cobro» (Thaler, 1999).
 *  - Autorregulación como bucle de retroalimentación (Carver y Scheier, 1982).
 *  - Fuerza del hábito (Wood y Neal, 2007) y ahorro por defecto / planificado (Thaler y Benartzi, 2004).
 *  - Escasez (Mullainathan y Shafir, 2013): el estrés económico estrecha el juicio.
 *  - Jerarquía de necesidades (Maslow, 1943), sólo como mapa de en qué nivel se gasta el dinero.
 *  - Autocontrol / escrupulosidad (Big Five), aproximada con regularidad y registro; búsqueda de riesgo (DOSPERT).
 *
 * Nunca sale por la API de la app: sólo la lee el proceso del panel, en la red privada. No usa IA ni envía nada a terceros.
 */
import { addDays } from '../lib/dates.js';
import type { FinancialProfile } from '../modules/profile/engine.js';
import { DISCRECIONAL, medir, sum, type Metricas, type Tx } from './psico-metricas.js';

export type Nivel = 'bajo' | 'medio' | 'alto';
export type Confianza = 'baja' | 'media' | 'alta';

export interface Rasgo {
  id: string;
  nombre: string;
  marco: string;
  /** 0–100. Su significado depende del rasgo (se explica en `lectura`). */
  puntos: number;
  nivel: Nivel;
  confianza: Confianza;
  evidencia: string[];
  lectura: string;
}
export interface Palanca { id: string; nombre: string; anualMinor: number; detalle: string }
export interface Hipotesis { observacion: string; explicaciones: string[]; paraDistinguir: string }

export interface PerfilPsico {
  disponible: boolean;
  motivo?: string;
  base?: { meses: number; movimientos: number };
  restriccion?: boolean;
  titular?: { nombre: string; frase: string; matices: string[] };
  guion?: { id: string; nombre: string; descripcion: string };
  necesidades?: { nivel: string; reparto: { nivel: string; pct: number }[] };
  rasgos?: Rasgo[];
  retrato?: string[];
  evolucion?: string[];
  cronologia?: { mes: string; ingresos: number; gastos: number; ahorroPct: number | null; discrecionalPct: number }[];
  ritmo?: { diaCobro: number | null; efectoCobro: number | null; tercios: number[] | null; semana: number[]; diaPico: string | null };
  revela?: string[];
  puntosCiegos?: string[];
  tensiones?: string[];
  hipotesis?: Hipotesis[];
  palancas?: Palanca[];
  preguntas?: string[];
  sinFiltro?: string[];
  limites: string[];
}

export const LIMITES = [
  'No es un diagnóstico ni un test psicológico: es una lectura de conducta a partir de importes y categorías.',
  'Sólo ve lo que la persona ha anotado o importado. Si usa otra cuenta, efectivo o dinero de terceros, la imagen queda incompleta.',
  'La misma conducta puede tener motivos opuestos (gastar poco puede ser disciplina o falta de ingresos). Por eso se avisa cuando el gasto está muy condicionado y se ofrecen hipótesis, no certezas.',
  'Los marcos teóricos se midieron con cuestionarios; aquí se aproximan con proxies de conducta y la correlación es modesta. Úsalo como hipótesis para conversar, no como veredicto.',
  'Con pocos meses de datos el resultado es muy inestable: los rasgos temporales (efecto día de cobro, autocorrección, inflación de estilo de vida) piden 4–6 meses.',
];

const SUBSISTENCIA = ['housing', 'utilities', 'groceries', 'insurance', 'health', 'transport'];
const OCIO = ['leisure', 'dining', 'travel'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const clamp = (n: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, n));
/** Escala lineal: a → 0, b → 100 (admite b < a para escalas invertidas). */
const lin = (x: number, a: number, b: number): number => clamp(((x - a) / (b - a)) * 100);
const nivel = (p: number): Nivel => (p < 35 ? 'bajo' : p < 65 ? 'medio' : 'alto');
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const pp = (x: number): string => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} pp`;

const quita = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RX = {
  apuestas: /(lotto|lotterie|tipico|bet365|bwin|betano|unibet|casino|spielbank|spielhalle|sportwetten|pokerstars|admiral|snai|sisal|superenalotto|loteria|apuestas|bet-at-home|\bbetway)/,
  cripto: /(bitpanda|coinbase|kraken|binance|bitvavo|crypto\.com|bitcoin|cripto|kryptow)/,
  credito: /(klarna|afterpay|ratepay|scalapay|ratenzahlung|rechnungskauf|santander consumer|cofidis|findomestic|creditplus|dispozins|sollzins)/,
  mora: /(mahngeb|mahnung|ruecklastschrift|inkasso|descubierto|mora\b|dispozins|sollzins|ueberziehung)/,
  efectivo: /(bargeld|geldautomat|\batm\b|cajero|auszahlung|cash26|prelievo)/,
  envios: /(western ?union|moneygram|remitly|worldremit|ria money|\bxoom\b|small world|envio de dinero|\bwise\b.*(mam|papa|familia))/,
  donacion: /(spende|donation|donacion|unicef|rotes kreuz|caritas|oxfam|greenpeace|aerzte ohne grenzen|wikimedia|medicos sin fronteras)/,
  reparto: /(lieferando|wolt|uber ?eats|glovo|just ?eat|deliveroo|flink|gorillas|getir|domino)/,
};

/** Reparto del gasto total (consumo + inversión) por nivel de necesidad (Maslow, sólo como mapa). */
function nivelesNecesidad(share: (ids: string[]) => number): { nivel: string; pct: number }[] {
  return [
    { nivel: 'Supervivencia y seguridad (vivienda, comida, suministros, seguros, salud, transporte)', pct: share(SUBSISTENCIA) },
    { nivel: 'Deuda (consumo adelantado)', pct: share(['debt']) },
    { nivel: 'Pertenencia y disfrute (restaurantes, ocio, viajes, suscripciones)', pct: share([...OCIO, 'subscriptions']) },
    { nivel: 'Estatus y posesiones (compras)', pct: share(['shopping']) },
    { nivel: 'Crecimiento y futuro (formación, inversión)', pct: share(['education', 'investing']) },
    { nivel: 'Sin etiquetar', pct: share(['other_expense']) },
  ].map((x) => ({ ...x, pct: Math.round(x.pct * 100) }));
}

export function construirPsico(txsTodas: Tx[], p: FinancialProfile, hoy: string): PerfilPsico {
  const desde = addDays(hoy, -365);
  const txs = txsTodas.filter((t) => t.date >= desde && t.date <= hoy);
  const gastos = txs.filter((t) => t.type === 'expense');
  const meses = new Set(txs.map((t) => t.date.slice(0, 7))).size;

  if (txs.length < 15 || meses < 2) {
    return {
      disponible: false,
      motivo: `Hacen falta al menos 15 movimientos repartidos en 2 meses para decir algo con sentido (ahora: ${txs.length} en ${meses}).`,
      limites: LIMITES,
    };
  }

  const M: Metricas = medir(txs, hoy);
  const E = sum(gastos.map((t) => t.amountMinor));
  const I = M.ingresos;
  const Ec = M.consumo; // consumo: gasto sin lo invertido
  const porCat = new Map<string, number>();
  for (const t of gastos) porCat.set(t.categoryId, (porCat.get(t.categoryId) ?? 0) + t.amountMinor);
  /** Peso sobre el consumo (sin contar lo invertido): así quien invierte mucho no «diluye» sus hábitos. */
  const share = (ids: string[]): number => (Ec ? sum(ids.map((i) => porCat.get(i) ?? 0)) / Ec : 0);
  const shareTotal = (ids: string[]): number => (E ? sum(ids.map((i) => porCat.get(i) ?? 0)) / E : 0);
  const texto = (t: Tx): string => quita(t.note ?? '');
  const gastoSegun = (rx: RegExp): { n: number; sum: number } => {
    const m = gastos.filter((t) => rx.test(texto(t)));
    return { n: m.length, sum: sum(m.map((t) => t.amountMinor)) };
  };
  const anual = (x: number): number => Math.round((x / Math.max(1, meses)) * 12);
  const eur = (minor: number): string => `${Math.round(minor / 100).toLocaleString('es-ES')} €`;

  // Ahorro efectivo: lo que no se consume (incluye lo invertido). El motor financiero cuenta lo invertido como gasto.
  const mesesIng = M.serie.filter((f) => f.ingresos > 0);
  const sIng = sum(mesesIng.map((f) => f.ingresos));
  const sr = sIng ? (sIng - sum(mesesIng.map((f) => f.consumo))) / sIng : p.savingsRate;
  const tasaInversion = I ? M.inversion / I : 0;
  const disc = Ec ? sum(DISCRECIONAL.concat('subscriptions').map((c) => porCat.get(c) ?? 0)) / Ec : p.discretionaryShare;
  const log = p.loggingConsistency;
  const sSub = share(SUBSISTENCIA);
  const sDeuda = share(['debt']);
  const sCompras = share(['shopping']);
  const sSusc = share(['subscriptions']);
  const sOtros = share(['other_expense']);
  const sFormacion = share(['education']);

  const apuestas = gastoSegun(RX.apuestas);
  const cripto = gastoSegun(RX.cripto);
  const credito = gastoSegun(RX.credito);
  const mora = gastoSegun(RX.mora);
  const efectivo = gastoSegun(RX.efectivo);
  const envios = gastoSegun(RX.envios);
  const donacion = gastoSegun(RX.donacion);
  const reparto = gastoSegun(RX.reparto);
  const fracC = (x: { sum: number }): number => (Ec ? x.sum / Ec : 0);

  // Compras pequeñas y frecuentes en categorías discrecionales («fuga de goteo»).
  const consumoTx = gastos.filter((t) => t.categoryId !== 'investing');
  const discr = consumoTx.filter((t) => ['dining', 'leisure', 'shopping', 'subscriptions', 'other_expense'].includes(t.categoryId));
  const chicas = discr.filter((t) => t.amountMinor < 1500);
  const chicasSemana = chicas.length / Math.max(4, meses * 4.3);
  const sumaChicas = sum(chicas.map((t) => t.amountMinor));
  const pesoChicas = Ec ? sumaChicas / Ec : 0;
  const pesoMayor = Ec ? consumoTx.reduce((m, t) => Math.max(m, t.amountMinor), 0) / Ec : 0;

  const restriccion = sSub + sDeuda >= 0.75 && sr < 0.1;
  const confBase: Confianza = meses >= 4 ? 'alta' : meses >= 3 ? 'media' : 'baja';
  const conf = (...menos: boolean[]): Confianza => {
    let c = confBase;
    for (const m of menos) if (m) c = c === 'alta' ? 'media' : 'baja';
    return restriccion ? 'baja' : c;
  };
  /** Los rasgos temporales piden más historia: nunca «alta» y «baja» con menos de 4 meses. */
  const confTemporal = (): Confianza => (restriccion || meses < 4 ? 'baja' : 'media');
  const rasgo = (r: Omit<Rasgo, 'nivel'>): Rasgo => ({ ...r, puntos: Math.round(r.puntos), nivel: nivel(r.puntos) });

  // ── Money Scripts ──────────────────────────────────────────────────────────
  const vigilancia = 0.4 * lin(sr, 0.05, 0.4) + 0.2 * lin(1 - disc, 0.5, 0.9) + 0.2 * lin(log, 0.3, 1) + 0.2 * lin(p.expenseCV, 0.6, 0.15);
  const estatus = 0.4 * lin(sCompras + share(['travel', 'dining']), 0.2, 0.55) + 0.3 * lin(1 - sr, 0.7, 1.1) + 0.3 * lin(disc, 0.2, 0.55);
  const adoracion = 0.5 * lin(fracC(apuestas) + fracC(cripto), 0, 0.08) + 0.25 * (p.incomeSources >= 2 ? 100 : 0) + 0.25 * lin(sCompras, 0.1, 0.35);
  const evitacion = 0.35 * lin(log, 0.8, 0.3) + 0.25 * lin(sOtros, 0.05, 0.3) + 0.2 * lin(fracC(efectivo), 0, 0.12) + 0.2 * lin(sr, 0.2, -0.1);

  const guiones = [
    { id: 'vigilancia', nombre: 'Vigilancia del dinero', descripcion: 'Atento, prudente y algo ansioso con el dinero; ahorra y lleva cuentas.', puntos: vigilancia },
    { id: 'estatus', nombre: 'Dinero como estatus', descripcion: 'Valora quién es por lo que tiene o aparenta; el gasto muestra posición.', puntos: estatus },
    { id: 'adoracion', nombre: 'Adoración del dinero', descripcion: 'Cree que más dinero resolvería sus problemas; persigue ingresos y golpes de suerte.', puntos: adoracion },
    { id: 'evitacion', nombre: 'Evitación del dinero', descripcion: 'Prefiere no mirar sus cuentas; el dinero le incomoda y lo deja correr.', puntos: evitacion },
  ].sort((a, b) => b.puntos - a.puntos);
  const dominante = guiones[0]!;

  const rasgos: Rasgo[] = [];
  for (const g of guiones) {
    const ev: string[] = [];
    if (g.id === 'vigilancia') ev.push(`Ahorra el ${pct(sr)} de lo que ingresa`, `Gasto discrecional: ${pct(disc)}`, `Constancia al anotar: ${pct(log)}`);
    if (g.id === 'estatus') ev.push(`Compras + restaurantes + viajes: ${pct(sCompras + share(['travel', 'dining']))} del consumo`, `Consume el ${pct(1 - sr)} de lo que ingresa`);
    if (g.id === 'adoracion') ev.push(apuestas.n || cripto.n ? `Apuestas/cripto: ${apuestas.n + cripto.n} movimientos (${pct(fracC(apuestas) + fracC(cripto))} del consumo)` : 'Sin señales de apuestas ni cripto', `Fuentes de ingreso: ${p.incomeSources}`);
    if (g.id === 'evitacion') ev.push(`Constancia al anotar: ${pct(log)}`, `Gasto sin etiquetar: ${pct(sOtros)}`, `Efectivo: ${pct(fracC(efectivo))} del consumo`);
    rasgos.push(rasgo({
      id: `guion-${g.id}`, nombre: g.nombre, marco: 'Money Scripts (Klontz)', puntos: g.puntos,
      confianza: conf(g.id === 'adoracion' || g.id === 'evitacion'), evidencia: ev,
      lectura: g === dominante ? `Es su guion dominante. ${g.descripcion}` : g.descripcion,
    }));
  }

  // ── Tacaño ↔ derrochador ───────────────────────────────────────────────────
  const derrochador = 0.5 * lin(sr, 0.4, 0) + 0.3 * lin(disc, 0.1, 0.5) + 0.2 * lin(chicasSemana, 2, 10);
  rasgos.push(rasgo({
    id: 'tacano-derrochador', nombre: 'Tacaño ↔ derrochador', marco: 'Tightwad–Spendthrift (Rick et al.)', puntos: derrochador, confianza: conf(),
    evidencia: [`Ahorro: ${pct(sr)}`, `Discrecional: ${pct(disc)}`, `Compras pequeñas discrecionales: ${chicasSemana.toFixed(1)} por semana`],
    lectura: derrochador >= 65 ? 'Del lado derrochador: pagar le duele poco y el gasto sale casi sin fricción.' : derrochador <= 35 ? 'Del lado tacaño: pagar le duele, y eso le protege… y a veces le impide disfrutar o invertir en sí mismo.' : 'En el centro: gasta y ahorra sin un patrón extremo.',
  }));

  // ── Sesgo al presente ──────────────────────────────────────────────────────
  const presente = 0.3 * lin(disc, 0.15, 0.5) + 0.25 * lin(sr, 0.3, 0) + 0.15 * lin(tasaInversion, 0.08, 0) + 0.15 * lin(p.weekendBias, 1, 2.2) + 0.15 * lin(fracC(credito) + sDeuda, 0, 0.15);
  rasgos.push(rasgo({
    id: 'presente', nombre: 'Orientación al presente', marco: 'Descuento hiperbólico / perspectiva temporal', puntos: presente, confianza: conf(),
    evidencia: [`Invierte el ${pct(tasaInversion)} de sus ingresos`, `Fin de semana: ×${p.weekendBias.toFixed(1)} el gasto diario`, `Deuda y crédito al consumo: ${pct(fracC(credito) + sDeuda)} del consumo`],
    lectura: presente >= 65 ? 'Prioriza la gratificación inmediata sobre el futuro: el yo de dentro de diez años casi no figura en sus decisiones.' : presente <= 35 ? 'Mira lejos: acepta renunciar hoy a cambio de mañana.' : 'Equilibrio razonable entre hoy y mañana.',
  }));

  // ── Autocontrol / planificación ────────────────────────────────────────────
  const control = 0.3 * lin(log, 0.2, 0.9) + 0.25 * lin(p.expenseCV, 0.7, 0.15) + 0.25 * lin(sr, 0, 0.3) + 0.2 * lin(p.fixedRatio, 0.15, 0.5);
  rasgos.push(rasgo({
    id: 'autocontrol', nombre: 'Autocontrol y planificación', marco: 'Big Five: escrupulosidad (orden y autodisciplina)', puntos: control, confianza: conf(),
    evidencia: [`Constancia al anotar: ${pct(log)}`, `Variación del gasto mes a mes: ${p.expenseCV.toFixed(2)}`, `Ahorro: ${pct(sr)}`],
    lectura: control >= 65 ? 'Ordenado y predecible con el dinero: tiene sistema.' : control <= 35 ? 'Improvisa: el dinero se gestiona sobre la marcha y casi sin sistema.' : 'Organización irregular: hay épocas de control y épocas de dejarlo pasar.',
  }));

  // ── Riesgo e impulsividad ──────────────────────────────────────────────────
  const hayRiesgo = apuestas.n + cripto.n + credito.n > 0;
  // La recurrencia cuenta tanto como el importe: apostar un poco todos los meses es un hábito, no un episodio.
  const mesesConRiesgo = new Set(gastos.filter((t) => RX.apuestas.test(texto(t)) || RX.cripto.test(texto(t))).map((t) => t.date.slice(0, 7))).size;
  const riesgo = 0.3 * lin(fracC(apuestas) + fracC(cripto), 0, 0.06) + 0.25 * lin(mesesConRiesgo / meses, 0, 0.8) + 0.15 * lin(fracC(credito), 0, 0.06) + 0.15 * lin(p.expenseCV, 0.2, 0.7) + 0.15 * lin(pesoMayor, 0.12, 0.4);
  rasgos.push(rasgo({
    id: 'riesgo', nombre: 'Búsqueda de riesgo e impulsividad', marco: 'DOSPERT / búsqueda de sensaciones', puntos: riesgo, confianza: conf(!hayRiesgo),
    evidencia: [apuestas.n ? `Apuestas o lotería: ${apuestas.n} movimientos` : 'Sin apuestas detectadas', cripto.n ? `Cripto: ${cripto.n} movimientos` : 'Sin cripto detectada', credito.n ? `Crédito aplazado: ${credito.n} movimientos` : 'Sin crédito aplazado', `Mayor gasto único: ${pct(pesoMayor)} del consumo`],
    lectura: riesgo >= 65 ? 'Convive con la apuesta y la volatilidad: busca el golpe grande o lo tolera bien.' : riesgo <= 35 ? 'Evita el riesgo financiero visible.' : 'Algo de riesgo, sin llegar a ser un patrón.',
  }));

  // ── Prevención ↔ promoción ─────────────────────────────────────────────────
  const prevencion = 0.6 * lin(share(['insurance']) + Math.max(0, sr), 0.02, 0.5) + 0.4 * lin(riesgo, 70, 10);
  const promocion = 0.4 * lin(tasaInversion + sFormacion, 0, 0.15) + 0.3 * lin(p.incomeSources, 1, 3) + 0.3 * lin(riesgo, 10, 70);
  const foco = clamp(50 + (promocion - prevencion) / 2);
  rasgos.push(rasgo({
    id: 'foco', nombre: 'Prevención ↔ promoción', marco: 'Enfoque regulatorio (Higgins)', puntos: foco, confianza: conf(),
    evidencia: [`Inversión + formación: ${pct(tasaInversion + sFormacion)}`, `Seguros: ${pct(share(['insurance']))} del consumo`, `Fuentes de ingreso: ${p.incomeSources}`],
    lectura: foco >= 62 ? 'Orientado a ganar: invierte en crecer y tolera incertidumbre.' : foco <= 38 ? 'Orientado a no perder: prioriza seguridad y colchón por encima del crecimiento.' : 'Mezcla de seguridad y crecimiento.',
  }));

  // ── Experiencias ↔ cosas ───────────────────────────────────────────────────
  const exp = share(['travel', 'leisure', 'dining']);
  const cosas = sCompras;
  const experiencial = exp + cosas > 0.08 ? (exp / (exp + cosas)) * 100 : 50;
  rasgos.push(rasgo({
    id: 'experiencial', nombre: 'Experiencias ↔ cosas', marco: 'Van Boven y Gilovich', puntos: experiencial, confianza: conf(exp + cosas < 0.15),
    evidencia: [`Experiencias (ocio, restaurantes, viajes): ${pct(exp)}`, `Cosas (compras): ${pct(cosas)}`],
    lectura: experiencial >= 65 ? 'Compra vivencias: más felicidad duradera por euro, según la investigación.' : experiencial <= 35 ? 'Compra objetos: el placer se agota rápido (adaptación hedónica).' : 'Reparte entre vivencias y objetos.',
  }));

  // ── Gasto prosocial / obligaciones ─────────────────────────────────────────
  const otros = fracC(donacion) + fracC(envios);
  rasgos.push(rasgo({
    id: 'prosocial', nombre: 'Gasto en otros', marco: 'Gasto prosocial (Dunn, Aknin y Norton)', puntos: lin(otros, 0, 0.1), confianza: conf(!donacion.n && !envios.n),
    evidencia: [donacion.n ? `Donaciones: ${donacion.n}` : 'Sin donaciones detectadas', envios.n ? `Envíos de dinero: ${envios.n}` : 'Sin envíos de dinero detectados'],
    lectura: otros > 0.04 ? 'Destina una parte seria a otras personas: sostén familiar o generosidad. Condiciona su capacidad de ahorro.' : 'Gasto en otros poco visible en estos datos.',
  }));

  // ── Tensión financiera ─────────────────────────────────────────────────────
  const tension = 0.35 * lin(sr, 0.1, -0.15) + 0.2 * lin(sDeuda + fracC(credito), 0, 0.2) + 0.2 * lin(p.incomeCV, 0.1, 0.5) + 0.25 * (mora.n ? lin(mora.n, 0, 3) : 0);
  rasgos.push(rasgo({
    id: 'tension', nombre: 'Tensión financiera', marco: 'Escasez / estrés financiero (Mullainathan y Shafir)', puntos: tension, confianza: conf(),
    evidencia: [`Ahorro: ${pct(sr)}`, `Deuda y crédito: ${pct(sDeuda + fracC(credito))} del consumo`, `Variación de ingresos: ${p.incomeCV.toFixed(2)}`, mora.n ? `Señales de mora o descubierto: ${mora.n}` : 'Sin señales de mora'],
    lectura: tension >= 65 ? 'Vive con margen mínimo o negativo: cualquier imprevisto es una crisis. El estrés económico estrecha el juicio y empuja a decisiones cortoplacistas.' : tension <= 35 ? 'Margen cómodo: puede decidir sin urgencia.' : 'Margen ajustado pero manejable.',
  }));

  // ── Rasgos que dependen del tiempo (necesitan meses) ───────────────────────
  if (M.mpc !== null) {
    rasgos.push(rasgo({
      id: 'inflacion', nombre: 'Inflación del estilo de vida', marco: 'Propensión marginal a consumir (Keynes) / ingreso permanente (Friedman)', puntos: lin(M.mpc, 0.2, 1), confianza: confTemporal(),
      evidencia: [M.mpc >= 0 ? `De cada euro extra que ingresa, gasta ${Math.round(Math.min(1.5, M.mpc) * 100)} céntimos` : 'Cuando sube su ingreso, su gasto baja', `Meses con ingresos: ${mesesIng.length}`],
      lectura: M.mpc >= 0.8 ? 'Cuando gana más, gasta más: el aumento de sueldo no se nota en su cuenta. Es el patrón que más frena la riqueza a largo plazo.' : M.mpc <= 0.3 ? 'Cuando gana más, casi no gasta más: protege lo extra. Señal sólida de autocontrol.' : 'Gasta parte de lo extra y ahorra parte.',
    }));
  }
  if (M.autocorreccion.ratio !== null) {
    rasgos.push(rasgo({
      id: 'autocorreccion', nombre: 'Autocorrección tras un exceso', marco: 'Autorregulación (Carver y Scheier)', puntos: lin(M.autocorreccion.ratio, 1.1, 0.85), confianza: confTemporal(),
      evidencia: [`Meses de gasto alto: ${M.autocorreccion.picos}`, `Mes siguiente: ${pct(M.autocorreccion.ratio)} de su gasto habitual`],
      lectura: M.autocorreccion.ratio <= 0.95 ? 'Tras un exceso, frena: tiene un termostato que compensa.' : M.autocorreccion.ratio >= 1.05 ? 'Tras un mes alto sigue igual o peor: no tiene bucle de corrección, el exceso se normaliza.' : 'Vuelve a su nivel habitual sin compensar.',
    }));
  }
  if (M.cobro.efecto !== null && M.cobro.dia !== null) {
    rasgos.push(rasgo({
      id: 'cobro', nombre: 'Efecto día de cobro', marco: 'Contabilidad mental (Thaler)', puntos: lin(M.cobro.efecto, 1, 2), confianza: confTemporal(),
      evidencia: [`Suele cobrar hacia el día ${M.cobro.dia}`, `Gasto discrecional de la primera semana tras cobrar: ×${M.cobro.efecto.toFixed(1)} lo esperable`],
      lectura: M.cobro.efecto >= 1.5 ? 'Se siente rico los días después de cobrar y gasta en ocio y compras justo entonces; el resto del mes paga la factura.' : M.cobro.efecto <= 1.1 ? 'Reparte el gasto de ocio a lo largo del mes: no hay euforia de cobro.' : 'Algo más de gasto tras cobrar, sin exagerar.',
    }));
  }
  if (M.rutina.recurrentesPct !== null) {
    rasgos.push(rasgo({
      id: 'rutina', nombre: 'Fuerza del hábito', marco: 'Hábito (Wood y Neal)', puntos: lin(M.rutina.recurrentesPct, 0.2, 0.7), confianza: conf(M.rutina.cobertura < 0.6),
      evidencia: [`Gasto en comercios que repite cada mes: ${pct(M.rutina.recurrentesPct)}`, `Tres comercios concentran el ${pct(M.rutina.top3Pct ?? 0)}`, `Comercios distintos: ${M.rutina.comercios}`],
      lectura: M.rutina.recurrentesPct >= 0.55 ? 'Vive de rutinas: compra casi siempre en los mismos sitios. Predecible y fácil de optimizar.' : M.rutina.recurrentesPct <= 0.3 ? 'Gasto disperso: muchos comercios distintos, poca rutina; suele ir con más impulso y novedad.' : 'Mezcla de rutina y novedad.',
    }));
  }
  const planificadoPuntos = M.planificado.regular ? 85 : 0.6 * lin(M.planificado.mesesConInversion / Math.max(1, M.serie.length), 0, 1);
  rasgos.push(rasgo({
    id: 'planificado', nombre: 'Ahorro planificado ↔ residual', marco: 'Ahorro por defecto (Thaler y Benartzi)', puntos: planificadoPuntos, confianza: conf(M.serie.length < 3),
    evidencia: [`Meses con inversión: ${M.planificado.mesesConInversion} de ${M.serie.length}`, M.planificado.regular ? 'Aportaciones regulares y de importe parecido' : 'Sin aportaciones regulares'],
    lectura: M.planificado.regular ? 'Ahorra primero y gasta después: el ahorro es una decisión automática, no un sobrante.' : sr > 0.1 ? 'Ahorra lo que sobra (ahorro residual): depende de que el mes salga bien.' : 'No hay ahorro planificado visible.',
  }));
  if (M.ahorroPositivoFrac !== null) {
    rasgos.push(rasgo({
      id: 'regularidad', nombre: 'Regularidad del ahorro', marco: 'Autorregulación financiera', puntos: 0.6 * lin(M.ahorroPositivoFrac, 0.3, 1) + 0.4 * lin(M.volAhorro ?? 0.3, 0.3, 0.05), confianza: conf(M.serie.length < 3),
      evidencia: [`Meses con saldo a favor: ${pct(M.ahorroPositivoFrac)}`, M.volAhorro !== null ? `Variación del ahorro mensual: ${pct(M.volAhorro)}` : 'Poca historia para medir la variación'],
      lectura: M.ahorroPositivoFrac >= 0.85 ? 'Casi todos los meses termina a favor: hábito consolidado.' : M.ahorroPositivoFrac <= 0.5 ? 'Menos de la mitad de los meses acaba a favor: el ahorro es una excepción.' : 'Ahorra en la mayoría de los meses, con recaídas.',
    }));
  }
  if (M.colchon.mesesCubiertos !== null) {
    rasgos.push(rasgo({
      id: 'colchon', nombre: 'Colchón acumulado', marco: 'Resiliencia financiera (ahorro precautorio)', puntos: lin(M.colchon.mesesCubiertos, 0, 6), confianza: conf(true),
      evidencia: [`Acumulado observado: ${M.colchon.mesesCubiertos.toFixed(1)} meses de consumo`, 'No incluye saldos previos ni dinero fuera de la app'],
      lectura: M.colchon.mesesCubiertos >= 3 ? 'Ha acumulado el equivalente a varios meses de gasto en este periodo: tiene margen ante un imprevisto.' : M.colchon.mesesCubiertos <= 0.5 ? 'Casi nada acumulado en el periodo: cualquier imprevisto va a deuda o a un favor.' : 'Algo de margen, aún por debajo de los 3 meses recomendados.',
    }));
  }

  // ── Mapa de necesidades ────────────────────────────────────────────────────
  const reparto2 = nivelesNecesidad(shareTotal);
  const mayorNivel = [...reparto2].sort((a, b) => b.pct - a.pct)[0]!;
  const necesidades = { nivel: mayorNivel.nivel, reparto: reparto2 };

  const nota = (id: string): Rasgo | undefined => rasgos.find((r) => r.id === id);
  const alto = (id: string): boolean => nota(id)?.nivel === 'alto';
  const bajo = (id: string): boolean => nota(id)?.nivel === 'bajo';

  // ── Arquetipo compuesto ────────────────────────────────────────────────────
  let titular: { nombre: string; frase: string };
  if (restriccion) titular = { nombre: 'Superviviente', frase: 'Su dinero está casi todo comprometido: más que elegir, resiste.' };
  else if (riesgo >= 60) titular = { nombre: 'Cazador de golpes', frase: 'Convive con el riesgo y la esperanza de un golpe de suerte; el ahorro no es su prioridad.' };
  else if (sr >= 0.25 && M.planificado.regular) titular = { nombre: 'Constructor', frase: 'Ahorra e invierte con sistema: está construyendo patrimonio de forma deliberada.' };
  else if (sr >= 0.25) titular = { nombre: 'Guardián', frase: 'Acumula por seguridad más que por ambición: el dinero es un escudo.' };
  else if (sr < 0.03 && derrochador >= 60) titular = { nombre: 'Gastador de lo inmediato', frase: 'Lo que entra, sale: vive del presente y el futuro queda para otro.' };
  else if (bajo('autocontrol') && log < 0.4) titular = { nombre: 'Improvisador', frase: 'Gestiona el dinero sobre la marcha y sin mirar; lo que no se ve, no se controla.' };
  else if (dominante.id === 'estatus' && dominante.puntos >= 50) titular = { nombre: 'Escaparate', frase: 'Parte de su gasto sirve para mostrar; el dinero comunica quién es.' };
  else titular = { nombre: 'Equilibrista', frase: 'Ni extremo ni sistemático: ahorra y gasta según el mes le permita.' };

  const matices: string[] = [];
  if (alto('inflacion')) matices.push('Su gasto sube con su sueldo');
  if (alto('cobro')) matices.push('Efecto día de cobro');
  if (alto('autocorreccion')) matices.push('Se corrige tras los excesos');
  if (bajo('autocorreccion')) matices.push('No se corrige tras los excesos');
  if (alto('rutina')) matices.push('Persona de costumbres');
  if (alto('planificado')) matices.push('Ahorro automático');
  if (chicasSemana >= 5) matices.push('Fuga de goteo');
  if (sSusc > 0.07) matices.push('Suscripciones de más');
  if (apuestas.n) matices.push('Apuestas');
  if (envios.n) matices.push('Sostén de otros');
  if (alto('colchon')) matices.push('Colchón sólido');
  if (bajo('colchon') && !restriccion) matices.push('Sin colchón');

  // ── Evolución en el tiempo ─────────────────────────────────────────────────
  const evolucion: string[] = [];
  if (M.mitades) {
    const [a1, a2] = M.mitades.ahorro;
    const d = a2 - a1;
    evolucion.push(Math.abs(d) < 0.03 ? `Ahorro estable entre la primera mitad del periodo (${pct(a1)}) y la segunda (${pct(a2)}).` : `Su ahorro ${d > 0 ? 'mejora' : 'empeora'}: ${pct(a1)} → ${pct(a2)} (${pp(d)}).`);
    const [d1, d2] = M.mitades.discrecional;
    if (Math.abs(d2 - d1) >= 0.04) evolucion.push(`El peso del gasto discrecional ${d2 > d1 ? 'sube' : 'baja'}: ${pct(d1)} → ${pct(d2)}.`);
    if (M.mitades.gastoCrece - M.mitades.ingresoCrece > 0.05) evolucion.push(`El gasto crece ${pct(M.mitades.gastoCrece)} frente a un ingreso que ${M.mitades.ingresoCrece > 0.005 ? `crece ${pct(M.mitades.ingresoCrece)}` : 'no crece'}: la brecha se estrecha mes a mes.`);
    else if (M.mitades.ingresoCrece - M.mitades.gastoCrece > 0.05) evolucion.push(`El ingreso crece ${pct(M.mitades.ingresoCrece)} y el gasto solo ${pct(Math.max(0, M.mitades.gastoCrece))}: está ensanchando su margen.`);
  }
  if (p.expenseTrend === 'rising') evolucion.push('El último mes completo gasta más que sus meses anteriores.');
  if (p.expenseTrend === 'falling') evolucion.push('El último mes completo gasta menos que sus meses anteriores.');

  // ── Retrato ────────────────────────────────────────────────────────────────
  const retrato: string[] = [];
  if (restriccion) {
    retrato.push(`El ${pct(sSub + sDeuda)} de lo que consume es obligado (vivienda, comida, suministros, deuda…) y casi no ahorra. Con ese margen, lo que se ve es sobre todo restricción, no carácter: cualquier conclusión psicológica es débil.`);
  } else {
    retrato.push(`${titular.nombre}: ${titular.frase}`);
    retrato.push(`Guion dominante con el dinero: ${dominante.nombre.toLowerCase()}. ${dominante.descripcion}`);
    if (sr < 0) retrato.push(`Gasta más de lo que ingresa (${pct(sr)}). Eso no es mala suerte sostenida: es una decisión que se repite cada mes y alguien (ahorros, deuda, otra persona) la está pagando.`);
    else if (sr >= 0.3 && disc < 0.25) retrato.push(`Ahorra con fuerza (${pct(sr)}) y gasta poco por gusto. Eso es disciplina, pero también puede ser miedo: conviene mirar si lo que ahorra lo pone a trabajar o lo guarda parado.`);
    else if (derrochador >= 65) retrato.push('Gasta con poca fricción: el dinero entra y sale sin que parezca doler. Lo que sobra a fin de mes es lo que quedó, no lo que se decidió guardar.');
    if (alto('presente')) retrato.push('Su dinero está pensado para hoy. Lo futuro (inversión, colchón) aparece poco o nada.');
    if (bajo('autocontrol')) retrato.push('Improvisa con el dinero: sin sistema, sin registro regular y con gastos que se mueven mucho de un mes a otro.');
    if (alto('inflacion')) retrato.push('Un dato incómodo: cuando sus ingresos suben, su gasto sube casi igual. Subirle el sueldo no cambiaría su situación; cambiaría su nivel de vida.');
    if (bajo('inflacion')) retrato.push('Un dato a su favor: cuando sus ingresos suben, no gasta más. Esa disciplina es rara y es la que construye patrimonio.');
    if (alto('cobro')) retrato.push(`Se nota el día de cobro (hacia el ${M.cobro.dia}): la semana siguiente gasta ×${M.cobro.efecto!.toFixed(1)} lo esperable en ocio y compras. Es contabilidad mental clásica: el dinero recién llegado «no cuenta».`);
    if (M.cobro.tercios && M.cobro.tercios[2] < 0.2 && M.cobro.tercios[0] > 0.45) retrato.push(`El ${pct(M.cobro.tercios[0])} de su gasto cotidiano cae en los diez primeros días tras cobrar; a final de ciclo vive con lo mínimo.`);
    if (bajo('autocorreccion')) retrato.push('Tras un mes de gasto alto no frena: el exceso se queda como nuevo normal.');
    if (alto('autocorreccion')) retrato.push('Tras un mes de gasto alto, compensa el siguiente: tiene un termostato interno y eso es una fortaleza real.');
    if (alto('rutina')) retrato.push('Es una persona de costumbres: casi todo su gasto va a comercios que repite mes tras mes. Sus hábitos mandan más que sus decisiones.');
  }

  const revela: string[] = [];
  revela.push(`Donde más pesa su dinero: ${mayorNivel.nivel.toLowerCase()} (${mayorNivel.pct} % del gasto).`);
  if (share(['dining']) + fracC(reparto) > 0.12) revela.push(`Restaurantes y comida a domicilio suman ${pct(share(['dining']))} del consumo${reparto.n ? ` (${reparto.n} pedidos a domicilio)` : ''}: compra comodidad y tiempo, o evita cocinar; también puede ser sociabilidad.`);
  if (sCompras > 0.2) revela.push(`Las compras pesan ${pct(sCompras)}: consumo material, a menudo regulación emocional («me lo merezco») y apariencia. Es el gasto que más se arrepiente después.`);
  if (sSusc > 0.07) revela.push(`Suscripciones: ${pct(sSusc)} del consumo. Es compromiso pasivo: se paga por inercia cosas que se usan poco.`);
  if (share(['travel']) > 0.1) revela.push(`Viajes: ${pct(share(['travel']))} del consumo. Busca escape y novedad; suele ser un gasto que sí se disfruta.`);
  if (share(['transport']) > 0.2) revela.push(`El transporte consume ${pct(share(['transport']))}: dependencia del coche o de largas distancias; es un coste de estilo de vida difícil de recortar.`);
  if (sFormacion + tasaInversion > 0.05) revela.push(`Destina ${pct(sFormacion + tasaInversion)} entre formación e inversión: orientación al crecimiento, lo que menos se ve en quienes viven al día.`);
  if (share(['housing']) > 0.4 && !restriccion) revela.push(`La vivienda pesa ${pct(share(['housing']))}: o vive caro por elección (estatus/comodidad) o no tiene alternativa.`);
  if (apuestas.n) revela.push(`Hay ${apuestas.n} movimientos de apuestas o lotería (${pct(fracC(apuestas))} del consumo): la esperanza de un golpe de suerte es parte de su relación con el dinero.`);
  if (cripto.n) revela.push(`Hay ${cripto.n} movimientos de cripto: apetito de riesgo y de «hacerse rico rápido», o simple diversificación; el contexto lo decide.`);
  if (envios.n) revela.push(`Envía dinero fuera (${envios.n} veces): responsabilidad familiar que limita su capacidad de ahorro y que ningún consejo de «gasta menos» tiene en cuenta.`);
  if (fracC(efectivo) > 0.05) revela.push(`El ${pct(fracC(efectivo))} de su consumo sale en efectivo: se pierde trazabilidad; o es costumbre o es una forma de no mirar.`);
  if (credito.n || sDeuda > 0.05) revela.push(`Usa crédito o deuda (${pct(sDeuda + fracC(credito))} del consumo): consume hoy con dinero de mañana.`);
  if (M.entropia !== null && M.entropia < 0.55) revela.push('Su gasto está muy concentrado en pocas categorías: vida sencilla y previsible, o dependencia de unos pocos costes.');
  if (M.entropia !== null && M.entropia > 0.85) revela.push('Gasta en muchas categorías a la vez: vida variada y, a la vez, más difícil de controlar.');
  if (M.ticket.topPct > 0.4) revela.push(`El ${pct(M.ticket.topPct)} de su gasto sale de unas pocas compras grandes: decisiones de peso, no goteo.`);
  if (M.diaPico !== null && M.semana[M.diaPico]! > 0.24) revela.push(`Su día de más gasto cotidiano es el ${DIAS[M.diaPico]} (${pct(M.semana[M.diaPico]!)} del total).`);

  // ── Fuga y palancas (en euros al año) ──────────────────────────────────────
  const palancas: Palanca[] = [];
  const palanca = (id: string, nombre: string, minor: number, detalle: string): void => { if (anual(minor) >= 5000) palancas.push({ id, nombre, anualMinor: anual(minor), detalle }); };
  palanca('goteo', 'Compras pequeñas discrecionales (< 15 €)', sumaChicas, `${chicas.length} compras en el periodo (${chicasSemana.toFixed(1)} por semana). Recortar a la mitad devolvería ${eur(anual(sumaChicas) / 2)} al año.`);
  palanca('suscripciones', 'Suscripciones', porCat.get('subscriptions') ?? 0, 'Revisar cuáles usa de verdad suele liberar un tercio.');
  palanca('domicilio', 'Comida a domicilio', reparto.sum, `${reparto.n} pedidos. El mismo gasto cocinando costaría cerca de la mitad.`);
  palanca('apuestas', 'Apuestas y lotería', apuestas.sum, 'Esperanza matemática negativa: dinero perdido de media.');
  palanca('compras', 'Compras (ropa, tecnología, hogar)', porCat.get('shopping') ?? 0, 'Una regla de 48 horas suele recortar un 20–30 % de lo no planificado.');
  palanca('sin-etiquetar', 'Gasto sin etiquetar', porCat.get('other_expense') ?? 0, 'No saber a dónde va es la fuga más cara: etiquetarlo ya suele recortarlo.');
  palanca('comisiones', 'Mora, recargos y descubierto', mora.sum, 'Dinero que no compra nada.');
  const finde = consumoTx.filter((t) => DISCRECIONAL.includes(t.categoryId) && ((new Date(`${t.date}T00:00:00Z`).getUTCDay() + 6) % 7) >= 5);
  const sumaFinde = sum(finde.map((t) => t.amountMinor));
  const totalDisc = sum(consumoTx.filter((t) => DISCRECIONAL.includes(t.categoryId)).map((t) => t.amountMinor));
  const excesoFinde = totalDisc ? sumaFinde - totalDisc * (2 / 7) : 0;
  if (excesoFinde > 0 && p.weekendBias > 1.3) palanca('finde', 'Exceso de gasto de fin de semana', excesoFinde, 'Lo que gasta de ocio en sábado y domingo por encima de un reparto uniforme.');
  palancas.sort((a, b) => b.anualMinor - a.anualMinor);

  // ── Puntos ciegos, tensiones, hipótesis ────────────────────────────────────
  const puntosCiegos: string[] = [];
  if (chicasSemana >= 5) puntosCiegos.push(`Unas ${Math.round(chicasSemana)} compras pequeñas discrecionales por semana pesan ${pct(pesoChicas)} del consumo: el goteo que nadie cuenta porque cada una «no es nada».`);
  if (p.weekendBias > 1.6) puntosCiegos.push(`Gasta ×${p.weekendBias.toFixed(1)} más los fines de semana: el ocio le sale caro y no lo presupuesta.`);
  if (sr > 0.1 && tasaInversion < 0.02 && !restriccion) puntosCiegos.push('Ahorra pero no invierte: el dinero parado pierde valor con la inflación; es ahorro por seguridad, no por ambición.');
  if (sOtros > 0.15) puntosCiegos.push(`El ${pct(sOtros)} de su consumo está sin etiquetar: no sabe, o prefiere no saber, a dónde se va.`);
  if (p.incomeCV > 0.35 && sr < 0.15) puntosCiegos.push('Ingresos muy variables y sin colchón: gasta como si el mes bueno fuera el normal.');
  if (log < 0.3) puntosCiegos.push('Anota poco: sus datos pueden esconder gasto real, y esa ceguera es en sí misma una forma de evitar mirar.');
  if (mora.n) puntosCiegos.push('Hay señales de descubierto, recargos o devoluciones: comisiones que no compran nada.');
  if (sSusc > 0.07) puntosCiegos.push('Seguramente mantiene suscripciones que no usa.');
  if (alto('cobro')) puntosCiegos.push('Planifica el mes desde el día de cobro con la cuenta llena: ahí es cuando peor decide.');
  if (alto('inflacion')) puntosCiegos.push('No ve que cada subida de ingresos se evapora: no tiene regla para lo extra.');

  const tensiones: string[] = [];
  if (sr > 0.15 && (sDeuda > 0.05 || fracC(credito) > 0.02)) tensiones.push('Ahorra mientras paga deuda: si la deuda cuesta más de lo que rinde su ahorro, pierde dinero con una mano mientras lo guarda con la otra.');
  if (log > 0.7 && sOtros > 0.15) tensiones.push('Anota casi todos los días pero deja sin etiquetar buena parte del gasto: registra sin analizar.');
  if (tasaInversion > 0.05 && M.colchon.mesesCubiertos !== null && M.colchon.mesesCubiertos < 3) tensiones.push('Invierte sin colchón suficiente: asume riesgo sin red; un imprevisto le obligaría a vender en mal momento.');
  if (dominante.id === 'vigilancia' && sCompras + share(['travel', 'dining']) > 0.4) tensiones.push('Se cree prudente pero gasta mucho en estatus y ocio: la prudencia es de intención, no de conducta.');
  if (I > 0 && sr < 0.05 && p.avgIncomeMinor > 250000 && !restriccion) tensiones.push('Gana bien y no ahorra: su límite no es el ingreso, es el nivel de vida que se ha construido.');
  if (alto('planificado') && alto('presente')) tensiones.push('Planifica el ahorro pero gasta como si no hubiera mañana el resto: dos personas en una cuenta.');
  if (alto('cobro') && sr > 0.2) tensiones.push('Ahorra bien pero se descontrola cada día de cobro: el ahorro funciona a pesar de sus impulsos, no gracias a ellos.');
  if (mora.n && sr > 0.1) tensiones.push('Tiene ahorro y aun así paga recargos o descubierto: es descuido, no falta de dinero.');

  const hipotesis: Hipotesis[] = [];
  if (sr > 0.1 && tasaInversion < 0.02 && !restriccion) hipotesis.push({ observacion: `Ahorra el ${pct(sr)} pero apenas invierte.`, explicaciones: ['Aversión a la pérdida: guardar le da tranquilidad aunque rinda poco.', 'Desconocimiento: no sabe por dónde empezar.', 'Ahorra para un gasto concreto y cercano (vivienda, coche, viaje).'], paraDistinguir: '¿Tiene una meta con fecha? Si sí, es plan; si no, es miedo o desconocimiento.' });
  if (sr < 0 && !restriccion) hipotesis.push({ observacion: 'Gasta más de lo que ingresa registrado.', explicaciones: ['Usa ahorros previos.', 'Tiene ingresos que no anota (efectivo, otra cuenta, ayuda familiar).', 'Se financia con deuda.'], paraDistinguir: '¿Crece la deuda o baja el saldo? Si no pasa ninguna de las dos, hay ingresos que no ve esta app.' });
  if (log < 0.3) hipotesis.push({ observacion: 'Anota poco.', explicaciones: ['Evitación: mirar le genera ansiedad.', 'Falta de tiempo o de hábito.', 'Gestiona el dinero en otra herramienta.'], paraDistinguir: '¿Esquiva la conversación sobre dinero? Quien evita suele esquivarla; quien no tiene tiempo suele pedir facilidades.' });
  if (share(['dining']) + fracC(reparto) > 0.12) hipotesis.push({ observacion: 'Mucho gasto en restaurantes y comida a domicilio.', explicaciones: ['Falta de tiempo o jornadas largas.', 'Sociabilidad: es su forma de ver gente.', 'Regulación emocional: comer fuera como recompensa o consuelo.'], paraDistinguir: '¿Gasta más en soledad (pedidos a casa) o en compañía (restaurantes los fines de semana)?' });
  if (alto('cobro')) hipotesis.push({ observacion: 'Gasta más en la semana posterior al cobro.', explicaciones: ['Contabilidad mental: el dinero recién llegado se siente «de regalo».', 'Pagos acumulados que se concentran tras cobrar (facturas, deudas con amigos).', 'Recompensa tras un periodo de sacrificio.'], paraDistinguir: '¿Son compras opcionales o pagos pendientes? Mirar las categorías de esa semana.' });
  if (alto('inflacion')) hipotesis.push({ observacion: 'Su gasto sube casi lo mismo que su ingreso.', explicaciones: ['Inflación del estilo de vida: se acostumbra a lo nuevo enseguida.', 'Costes obligados que suben a la vez (alquiler, familia).', 'Pagos extra ligados a las subidas (impuestos, comisiones).'], paraDistinguir: '¿Se concentra la subida en ocio y compras (elección) o en vivienda y suministros (obligación)?' });
  if (fracC(efectivo) > 0.05) hipotesis.push({ observacion: 'Retira bastante efectivo.', explicaciones: ['Comodidad o costumbre.', 'Control del gasto con sobres.', 'Evitar rastro: gasto que prefiere no ver.'], paraDistinguir: '¿Aparece luego en «sin etiquetar»? Si sí, es ceguera; si se reparte, es hábito.' });
  if (bajo('autocorreccion')) hipotesis.push({ observacion: 'Tras un mes alto no compensa.', explicaciones: ['No tiene un presupuesto de referencia.', 'Su gasto alto no era un exceso, sino un cambio de nivel.'], paraDistinguir: '¿Ha subido también el ingreso? Si no, es un cambio de nivel no financiado.' });

  const preguntas: string[] = [];
  if (M.mesPico) preguntas.push(`¿Qué pasó en ${M.mesPico}? Es su mes de mayor consumo.`);
  if (sr > 0.1) preguntas.push('¿Para qué ahorra? Si no sabe responder en una frase, el ahorro es un miedo, no un plan.');
  if (sr <= 0.05 && !restriccion) preguntas.push('Si mañana le subieran el sueldo un 10 %, ¿qué cambiaría en su cuenta dentro de tres meses?');
  if (alto('cobro')) preguntas.push('¿Cómo se siente el día que cobra y cómo el día 25?');
  if (envios.n) preguntas.push('¿A quién envía dinero y hasta cuándo? Es parte de su plan o parte de su carga.');
  if (sSusc > 0.07) preguntas.push('¿Qué suscripciones usó de verdad la última semana?');
  if (apuestas.n) preguntas.push('¿Cuánto apostó el último mes y cuánto le gustaría haber apostado?');
  if (log < 0.4) preguntas.push('¿Qué le pasa cuando abre la app y ve sus gastos?');
  if (!preguntas.length) preguntas.push('¿Qué decisión de dinero de los últimos seis meses le hizo sentir mejor y cuál peor?');

  const sinFiltro: string[] = [];
  if (sr < 0.05 && !restriccion) sinFiltro.push('Sin margen no hay libertad: fija primero un ahorro automático el día que cobra y gasta lo que quede, no al revés.');
  if (derrochador >= 65) sinFiltro.push('Pon fricción al gasto fácil: retira tarjetas de apps, espera 48 horas antes de comprar lo que no es necesario.');
  if (alto('presente')) sinFiltro.push('Su problema no es saber qué hacer, es que el futuro no le parece real. Automatiza: lo que no se decide cada mes, no se vence.');
  if (sr > 0.1 && tasaInversion < 0.02 && !restriccion) sinFiltro.push('Deja de ahorrar por miedo: define un colchón (3–6 meses de gasto) y pon el resto a invertir de forma automática.');
  if (bajo('autocontrol')) sinFiltro.push('Un sistema simple supera a la fuerza de voluntad: una cuenta para lo fijo, otra para el día a día y revisión semanal de diez minutos.');
  if (apuestas.n) sinFiltro.push('Las apuestas tienen esperanza matemática negativa: cualquier euro ahí es un euro que se pierde de media. Si no es puntual, conviene pedir ayuda.');
  if (alto('cobro')) sinFiltro.push('Mueve el ahorro y las facturas el día de cobro: lo que queda en la cuenta es el único dinero que tiene permiso para gastar.');
  if (alto('inflacion')) sinFiltro.push('Regla del aumento: de cada subida de ingresos, la mitad se ahorra antes de que llegue a la cuenta corriente.');
  if (bajo('autocorreccion')) sinFiltro.push('Ponle techo mensual a ocio y compras: si no hay termostato, lo tiene que poner una regla.');
  if (restriccion) sinFiltro.push('Antes que cambiar hábitos, hay que subir ingresos o reducir un coste fijo grande: no se ahorra lo que no sobra.');
  if (palancas[0] && !restriccion) sinFiltro.push(`La palanca más grande es «${palancas[0].nombre.toLowerCase()}»: unos ${eur(palancas[0].anualMinor)} al año.`);
  if (!sinFiltro.length) sinFiltro.push('Mantén lo que hace; el siguiente paso es automatizar y revisar una vez al trimestre.');

  const cronologia = M.serie.map((f) => ({ mes: f.mes, ingresos: f.ingresos, gastos: f.consumo + f.inversion, ahorroPct: f.ahorroPct === null ? null : Math.round(f.ahorroPct * 100), discrecionalPct: f.consumo ? Math.round((f.discrecional / f.consumo) * 100) : 0 }));

  return {
    disponible: true,
    base: { meses, movimientos: txs.length },
    restriccion,
    titular: { ...titular, matices },
    guion: { id: dominante.id, nombre: dominante.nombre, descripcion: dominante.descripcion },
    necesidades,
    rasgos,
    retrato,
    evolucion,
    cronologia,
    ritmo: {
      diaCobro: M.cobro.dia,
      efectoCobro: M.cobro.efecto === null ? null : Number(M.cobro.efecto.toFixed(2)),
      tercios: M.cobro.tercios ? M.cobro.tercios.map((x) => Math.round(x * 100)) : null,
      semana: M.semana.map((x) => Math.round(x * 100)),
      diaPico: M.diaPico === null ? null : DIAS[M.diaPico]!,
    },
    revela,
    puntosCiegos,
    tensiones,
    hipotesis,
    palancas: palancas.slice(0, 6),
    preguntas,
    sinFiltro,
    limites: LIMITES,
  };
}

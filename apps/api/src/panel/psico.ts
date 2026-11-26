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
 *  - Teoría del enfoque regulatorio (Higgins, 1997): prevención (seguridad) frente a promoción (crecimiento).
 *  - Gasto experiencial frente a material (Van Boven y Gilovich, 2003) y gasto prosocial (Dunn, Aknin y Norton, 2008).
 *  - Jerarquía de necesidades (Maslow, 1943), sólo como mapa de en qué nivel se gasta el dinero.
 *  - Autocontrol / escrupulosidad (Big Five, faceta de orden y autodisciplina), aproximada con regularidad y registro.
 *  - Búsqueda de sensaciones y conducta de riesgo (DOSPERT, Blais y Weber, 2006), aproximada con apuestas y cripto.
 *
 * Nunca sale por la API de la app: sólo la lee el proceso del panel, en la red privada. No usa IA ni envía nada a terceros.
 */
import type { Transaction } from '@econsultor/shared';
import { addDays } from '../lib/dates.js';
import type { FinancialProfile } from '../modules/profile/engine.js';

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

export interface PerfilPsico {
  disponible: boolean;
  motivo?: string;
  /** Meses de datos usados y cuántos movimientos. */
  base?: { meses: number; movimientos: number };
  restriccion?: boolean;
  guion?: { id: string; nombre: string; descripcion: string };
  necesidades?: { nivel: string; reparto: { nivel: string; pct: number }[] };
  rasgos?: Rasgo[];
  retrato?: string[];
  revela?: string[];
  puntosCiegos?: string[];
  sinFiltro?: string[];
  limites: string[];
}

export const LIMITES = [
  'No es un diagnóstico ni un test psicológico: es una lectura de conducta a partir de importes y categorías.',
  'Sólo ve lo que la persona ha anotado o importado. Si usa otra cuenta, efectivo o dinero de terceros, la imagen queda incompleta.',
  'La misma conducta puede tener motivos opuestos (gastar poco puede ser disciplina o falta de ingresos). Por eso se avisa cuando el gasto está muy condicionado.',
  'Los marcos teóricos se midieron con cuestionarios; aquí se aproximan con proxies de conducta y la correlación es modesta. Úsalo como hipótesis para conversar, no como veredicto.',
  'Con pocos meses de datos el resultado es muy inestable.',
];

type Tx = Pick<Transaction, 'date' | 'type' | 'categoryId' | 'amountMinor'> & { note?: string };

const clamp = (n: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, n));
/** Escala lineal: a → 0, b → 100 (admite b < a para escalas invertidas). */
const lin = (x: number, a: number, b: number): number => clamp(((x - a) / (b - a)) * 100);
const nivel = (p: number): Nivel => (p < 35 ? 'bajo' : p < 65 ? 'medio' : 'alto');
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const SUBSISTENCIA = ['housing', 'utilities', 'groceries', 'insurance', 'health', 'transport'];
const OCIO = ['leisure', 'dining', 'travel'];

// Señales en el texto del movimiento (ya en minúsculas, sin acentos al compararlo).
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

/** Reparto del gasto por nivel de necesidad (Maslow, sólo como mapa). */
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
  const ingresos = txs.filter((t) => t.type === 'income');
  const meses = new Set(txs.map((t) => t.date.slice(0, 7))).size;

  if (txs.length < 15 || meses < 2) {
    return {
      disponible: false,
      motivo: `Hacen falta al menos 15 movimientos repartidos en 2 meses para decir algo con sentido (ahora: ${txs.length} en ${meses}).`,
      limites: LIMITES,
    };
  }

  const E = sum(gastos.map((t) => t.amountMinor));
  const I = sum(ingresos.map((t) => t.amountMinor));
  const porCat = new Map<string, number>();
  for (const t of gastos) porCat.set(t.categoryId, (porCat.get(t.categoryId) ?? 0) + t.amountMinor);
  const share = (ids: string[]): number => (E ? sum(ids.map((i) => porCat.get(i) ?? 0)) / E : 0);
  const texto = (t: Tx): string => quita(t.note ?? '');
  const gastoSegun = (rx: RegExp): { n: number; sum: number } => {
    const m = gastos.filter((t) => rx.test(texto(t)));
    return { n: m.length, sum: sum(m.map((t) => t.amountMinor)) };
  };

  const sr = p.savingsRate;
  const disc = p.discretionaryShare;
  const log = p.loggingConsistency;
  const sSub = share(SUBSISTENCIA);
  const sDeuda = share(['debt']);
  const sOcio = share(OCIO);
  const sCompras = share(['shopping']);
  const sSusc = share(['subscriptions']);
  const sOtros = share(['other_expense']);
  const sFormacion = share(['education']);
  const sInversion = share(['investing']);
  const tasaInversion = I ? (porCat.get('investing') ?? 0) / I : 0;

  const apuestas = gastoSegun(RX.apuestas);
  const cripto = gastoSegun(RX.cripto);
  const credito = gastoSegun(RX.credito);
  const mora = gastoSegun(RX.mora);
  const efectivo = gastoSegun(RX.efectivo);
  const envios = gastoSegun(RX.envios);
  const donacion = gastoSegun(RX.donacion);
  const reparto = gastoSegun(RX.reparto);
  const frac = (x: { sum: number }): number => (E ? x.sum / E : 0);

  // Compras pequeñas y frecuentes en categorías discrecionales («fuga de goteo»).
  const discr = gastos.filter((t) => ['dining', 'leisure', 'shopping', 'subscriptions', 'other_expense'].includes(t.categoryId));
  const chicas = discr.filter((t) => t.amountMinor < 1500);
  const semanas = Math.max(4, meses * 4.3);
  const chicasSemana = chicas.length / semanas;
  const pesoChicas = E ? sum(chicas.map((t) => t.amountMinor)) / E : 0;
  const mayor = gastos.reduce((m, t) => Math.max(m, t.amountMinor), 0);
  const pesoMayor = E ? mayor / E : 0;

  const restriccion = sSub + sDeuda >= 0.75 && sr < 0.1;
  const confBase: Confianza = meses >= 4 ? 'alta' : meses >= 3 ? 'media' : 'baja';
  const conf = (...menos: boolean[]): Confianza => {
    let c = confBase;
    for (const m of menos) if (m) c = c === 'alta' ? 'media' : 'baja';
    return restriccion ? 'baja' : c;
  };
  const rasgo = (r: Omit<Rasgo, 'nivel'>): Rasgo => ({ ...r, puntos: Math.round(r.puntos), nivel: nivel(r.puntos) });

  // ── Money Scripts ──────────────────────────────────────────────────────────
  const vigilancia = 0.4 * lin(sr, 0.05, 0.4) + 0.2 * lin(1 - disc, 0.5, 0.9) + 0.2 * lin(log, 0.3, 1) + 0.2 * lin(p.expenseCV, 0.6, 0.15);
  const estatus = 0.4 * lin(sCompras + share(['travel', 'dining']), 0.2, 0.55) + 0.3 * lin(1 - sr, 0.7, 1.1) + 0.3 * lin(disc, 0.2, 0.55);
  const adoracion = 0.5 * lin(frac(apuestas) + frac(cripto), 0, 0.08) + 0.25 * (p.incomeSources >= 2 ? 100 : 0) + 0.25 * lin(sCompras, 0.1, 0.35);
  const evitacion = 0.35 * lin(log, 0.8, 0.3) + 0.25 * lin(sOtros, 0.05, 0.3) + 0.2 * lin(frac(efectivo), 0, 0.12) + 0.2 * lin(sr, 0.2, -0.1);

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
    if (g.id === 'estatus') ev.push(`Compras + restaurantes + viajes: ${pct(sCompras + share(['travel', 'dining']))} del gasto`, `Gasta el ${pct(1 - sr)} de lo que ingresa`);
    if (g.id === 'adoracion') ev.push(apuestas.n || cripto.n ? `Apuestas/cripto: ${apuestas.n + cripto.n} movimientos (${pct(frac(apuestas) + frac(cripto))} del gasto)` : 'Sin señales de apuestas ni cripto', `Fuentes de ingreso: ${p.incomeSources}`);
    if (g.id === 'evitacion') ev.push(`Constancia al anotar: ${pct(log)}`, `Gasto sin etiquetar: ${pct(sOtros)}`, `Efectivo: ${pct(frac(efectivo))} del gasto`);
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
  const presente = 0.3 * lin(disc, 0.15, 0.5) + 0.25 * lin(sr, 0.3, 0) + 0.15 * lin(tasaInversion, 0.08, 0) + 0.15 * lin(p.weekendBias, 1, 2.2) + 0.15 * lin(frac(credito) + sDeuda, 0, 0.15);
  rasgos.push(rasgo({
    id: 'presente', nombre: 'Orientación al presente', marco: 'Descuento hiperbólico / perspectiva temporal', puntos: presente, confianza: conf(),
    evidencia: [`Invierte el ${pct(tasaInversion)} de sus ingresos`, `Fin de semana: ×${p.weekendBias.toFixed(1)} el gasto diario`, `Deuda y crédito al consumo: ${pct(frac(credito) + sDeuda)} del gasto`],
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
  const riesgo = 0.3 * lin(frac(apuestas) + frac(cripto), 0, 0.06) + 0.25 * lin(mesesConRiesgo / meses, 0, 0.8) + 0.15 * lin(frac(credito), 0, 0.06) + 0.15 * lin(p.expenseCV, 0.2, 0.7) + 0.15 * lin(pesoMayor, 0.12, 0.4);
  rasgos.push(rasgo({
    id: 'riesgo', nombre: 'Búsqueda de riesgo e impulsividad', marco: 'DOSPERT / búsqueda de sensaciones', puntos: riesgo, confianza: conf(!hayRiesgo),
    evidencia: [apuestas.n ? `Apuestas o lotería: ${apuestas.n} movimientos` : 'Sin apuestas detectadas', cripto.n ? `Cripto: ${cripto.n} movimientos` : 'Sin cripto detectada', credito.n ? `Crédito aplazado: ${credito.n} movimientos` : 'Sin crédito aplazado', `Mayor gasto único: ${pct(pesoMayor)} del total`],
    lectura: riesgo >= 65 ? 'Convive con la apuesta y la volatilidad: busca el golpe grande o lo tolera bien.' : riesgo <= 35 ? 'Evita el riesgo financiero visible.' : 'Algo de riesgo, sin llegar a ser un patrón.',
  }));

  // ── Prevención ↔ promoción ─────────────────────────────────────────────────
  const prevencion = 0.6 * lin(share(['insurance']) + Math.max(0, sr), 0.02, 0.5) + 0.4 * lin(riesgo, 70, 10);
  const promocion = 0.4 * lin(tasaInversion + sFormacion, 0, 0.15) + 0.3 * lin(p.incomeSources, 1, 3) + 0.3 * lin(riesgo, 10, 70);
  const foco = clamp(50 + (promocion - prevencion) / 2);
  rasgos.push(rasgo({
    id: 'foco', nombre: 'Prevención ↔ promoción', marco: 'Enfoque regulatorio (Higgins)', puntos: foco, confianza: conf(),
    evidencia: [`Inversión + formación: ${pct(tasaInversion + sFormacion)} de lo que ingresa`, `Seguros: ${pct(share(['insurance']))} del gasto`, `Fuentes de ingreso: ${p.incomeSources}`],
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
  const otros = frac(donacion) + frac(envios);
  rasgos.push(rasgo({
    id: 'prosocial', nombre: 'Gasto en otros', marco: 'Gasto prosocial (Dunn, Aknin y Norton)', puntos: lin(otros, 0, 0.1), confianza: conf(!donacion.n && !envios.n),
    evidencia: [donacion.n ? `Donaciones: ${donacion.n}` : 'Sin donaciones detectadas', envios.n ? `Envíos de dinero: ${envios.n}` : 'Sin envíos de dinero detectados'],
    lectura: otros > 0.04 ? 'Destina una parte seria a otras personas: sostén familiar o generosidad. Condiciona su capacidad de ahorro.' : 'Gasto en otros poco visible en estos datos.',
  }));

  // ── Tensión financiera ─────────────────────────────────────────────────────
  const tension = 0.35 * lin(sr, 0.1, -0.15) + 0.2 * lin(sDeuda + frac(credito), 0, 0.2) + 0.2 * lin(p.incomeCV, 0.1, 0.5) + 0.25 * (mora.n ? lin(mora.n, 0, 3) : 0);
  rasgos.push(rasgo({
    id: 'tension', nombre: 'Tensión financiera', marco: 'Estrés financiero (indicador de conducta)', puntos: tension, confianza: conf(),
    evidencia: [`Ahorro: ${pct(sr)}`, `Deuda y crédito: ${pct(sDeuda + frac(credito))} del gasto`, `Variación de ingresos: ${p.incomeCV.toFixed(2)}`, mora.n ? `Señales de mora o descubierto: ${mora.n}` : 'Sin señales de mora'],
    lectura: tension >= 65 ? 'Vive con margen mínimo o negativo: cualquier imprevisto es una crisis. El estrés económico distorsiona el juicio (efecto de escasez, Mullainathan y Shafir).' : tension <= 35 ? 'Margen cómodo: puede decidir sin urgencia.' : 'Margen ajustado pero manejable.',
  }));

  // ── Mapa de necesidades ────────────────────────────────────────────────────
  const reparto2 = nivelesNecesidad(share);
  const mayorNivel = [...reparto2].sort((a, b) => b.pct - a.pct)[0]!;
  const necesidades = { nivel: mayorNivel.nivel, reparto: reparto2 };

  // ── Lectura en palabras ────────────────────────────────────────────────────
  const retrato: string[] = [];
  const nota = (id: string): Rasgo => rasgos.find((r) => r.id === id)!;
  if (restriccion) {
    retrato.push(`El ${pct(sSub + sDeuda)} de lo que gasta es obligado (vivienda, comida, suministros, deuda…) y casi no ahorra. Con ese margen, lo que se ve es sobre todo restricción, no carácter: cualquier conclusión psicológica es débil.`);
  } else {
    retrato.push(`Perfil dominante: ${dominante.nombre.toLowerCase()}. ${dominante.descripcion}`);
    if (sr < 0) retrato.push(`Gasta más de lo que ingresa (${pct(sr)}). Eso no es mala suerte sostenida: es una decisión que se repite cada mes y alguien (ahorros, deuda, otra persona) la está pagando.`);
    else if (sr >= 0.3 && disc < 0.25) retrato.push(`Ahorra con fuerza (${pct(sr)}) y gasta poco por gusto. Eso es disciplina, pero también puede ser miedo: conviene mirar si lo que ahorra lo pone a trabajar o lo guarda parado.`);
    else if (derrochador >= 65) retrato.push('Gasta con poca fricción: el dinero entra y sale sin que parezca doler. Lo que sobra a fin de mes es lo que quedó, no lo que se decidió guardar.');
    if (nota('presente').nivel === 'alto') retrato.push('Su dinero está pensado para hoy. Lo futuro (inversión, colchón) aparece poco o nada.');
    if (nota('autocontrol').nivel === 'bajo') retrato.push('Improvisa con el dinero: sin sistema, sin registro regular y con gastos que se mueven mucho de un mes a otro.');
  }

  const revela: string[] = [];
  revela.push(`Donde más pesa su dinero: ${mayorNivel.nivel.toLowerCase()} (${mayorNivel.pct} % del gasto).`);
  if (share(['dining']) + frac(reparto) > 0.12) revela.push(`Restaurantes y comida a domicilio suman ${pct(share(['dining']))} del gasto${reparto.n ? ` (${reparto.n} pedidos a domicilio)` : ''}: compra comodidad y tiempo, o evita cocinar; también puede ser sociabilidad.`);
  if (sCompras > 0.2) revela.push(`Las compras pesan ${pct(sCompras)}: consumo material, a menudo regulación emocional («me lo merezco») y apariencia. Es el gasto que más se arrepiente después.`);
  if (sSusc > 0.07) revela.push(`Suscripciones: ${pct(sSusc)} del gasto. Es compromiso pasivo: se paga por inercia cosas que se usan poco.`);
  if (share(['travel']) > 0.1) revela.push(`Viajes: ${pct(share(['travel']))} del gasto. Busca escape y novedad; suele ser un gasto que sí se disfruta.`);
  if (share(['transport']) > 0.2) revela.push(`El transporte consume ${pct(share(['transport']))}: dependencia del coche o de largas distancias; es un coste de estilo de vida difícil de recortar.`);
  if (sFormacion + sInversion > 0.05) revela.push(`Destina ${pct(sFormacion + sInversion)} del gasto a formación e inversión: orientación al crecimiento, lo que menos se ve en quienes viven al día.`);
  if (share(['housing']) > 0.4 && !restriccion) revela.push(`La vivienda pesa ${pct(share(['housing']))}: o vive caro por elección (estatus/comodidad) o no tiene alternativa.`);
  if (apuestas.n) revela.push(`Hay ${apuestas.n} movimientos de apuestas o lotería (${pct(frac(apuestas))} del gasto): la esperanza de un golpe de suerte es parte de su relación con el dinero.`);
  if (cripto.n) revela.push(`Hay ${cripto.n} movimientos de cripto: apetito de riesgo y de «hacerse rico rápido», o simple diversificación; el contexto lo decide.`);
  if (envios.n) revela.push(`Envía dinero fuera (${envios.n} veces): responsabilidad familiar que limita su capacidad de ahorro y que ningún consejo de «gasta menos» tiene en cuenta.`);
  if (credito.n || sDeuda > 0.05) revela.push(`Usa crédito o deuda (${pct(sDeuda + frac(credito))} del gasto): consume hoy con dinero de mañana.`);

  const puntosCiegos: string[] = [];
  if (chicasSemana >= 5) puntosCiegos.push(`Unas ${Math.round(chicasSemana)} compras pequeñas discrecionales por semana pesan ${pct(pesoChicas)} del gasto: el goteo que nadie cuenta porque cada una «no es nada».`);
  if (p.weekendBias > 1.6) puntosCiegos.push(`Gasta ×${p.weekendBias.toFixed(1)} más los fines de semana: el ocio le sale caro y no lo presupuesta.`);
  if (sr > 0.1 && tasaInversion < 0.02 && !restriccion) puntosCiegos.push('Ahorra pero no invierte: el dinero parado pierde valor con la inflación; es ahorro por seguridad, no por ambición.');
  if (sOtros > 0.15) puntosCiegos.push(`El ${pct(sOtros)} de su gasto está sin etiquetar: no sabe, o prefiere no saber, a dónde se va.`);
  if (p.incomeCV > 0.35 && sr < 0.15) puntosCiegos.push('Ingresos muy variables y sin colchón: gasta como si el mes bueno fuera el normal.');
  if (log < 0.3) puntosCiegos.push('Anota poco: sus datos pueden esconder gasto real, y esa ceguera es en sí misma una forma de evitar mirar.');
  if (mora.n) puntosCiegos.push('Hay señales de descubierto, recargos o devoluciones: comisiones que no compran nada.');
  if (sSusc > 0.07) puntosCiegos.push('Seguramente mantiene suscripciones que no usa.');

  const sinFiltro: string[] = [];
  if (sr < 0.05 && !restriccion) sinFiltro.push('Sin margen no hay libertad: fija primero un ahorro automático el día que cobra y gasta lo que quede, no al revés.');
  if (derrochador >= 65) sinFiltro.push('Pon fricción al gasto fácil: retira tarjetas de apps, espera 48 horas antes de comprar lo que no es necesario.');
  if (nota('presente').nivel === 'alto') sinFiltro.push('Su problema no es saber qué hacer, es que el futuro no le parece real. Automatiza: lo que no se decide cada mes, no se vence.');
  if (sr > 0.1 && tasaInversion < 0.02 && !restriccion) sinFiltro.push('Deja de ahorrar por miedo: define un colchón (3–6 meses de gasto) y pon el resto a invertir de forma automática.');
  if (nota('autocontrol').nivel === 'bajo') sinFiltro.push('Un sistema simple supera a la fuerza de voluntad: una cuenta para lo fijo, otra para el día a día y revisión semanal de diez minutos.');
  if (apuestas.n) sinFiltro.push('Las apuestas tienen esperanza matemática negativa: cualquier euro ahí es un euro que se pierde de media. Si no es puntual, conviene pedir ayuda.');
  if (restriccion) sinFiltro.push('Antes que cambiar hábitos, hay que subir ingresos o reducir un coste fijo grande: no se ahorra lo que no sobra.');
  if (!sinFiltro.length) sinFiltro.push('Mantén lo que hace; el siguiente paso es automatizar y revisar una vez al trimestre.');

  return {
    disponible: true,
    base: { meses, movimientos: txs.length },
    restriccion,
    guion: { id: dominante.id, nombre: dominante.nombre, descripcion: dominante.descripcion },
    necesidades,
    rasgos,
    retrato,
    revela,
    puntosCiegos,
    sinFiltro,
    limites: LIMITES,
  };
}

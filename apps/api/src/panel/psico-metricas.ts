/**
 * Medidas de conducta para la evaluación psico-económica (solo panel). Todo son agregados: el texto libre
 * de los movimientos se usa únicamente para agrupar comercios y detectar señales, y nunca sale de aquí.
 */
import type { Transaction } from '@econsultor/shared';
import { merchantKey } from '../modules/import/merchant.js';

export type Tx = Pick<Transaction, 'date' | 'type' | 'categoryId' | 'amountMinor'> & { note?: string };

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
export const media = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);
export const desv = (xs: number[]): number => {
  const m = media(xs);
  return xs.length > 1 ? Math.sqrt(media(xs.map((x) => (x - m) ** 2))) : 0;
};
export const mediana = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const percentil = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/** Categorías de «consumo cotidiano» para el ritmo semanal (las cuotas fijas distorsionan el día de la semana). */
export const COTIDIANO = ['groceries', 'dining', 'leisure', 'shopping', 'transport', 'health', 'travel', 'subscriptions', 'other_expense'];
export const DISCRECIONAL = ['dining', 'leisure', 'shopping', 'travel'];

export interface FilaMes {
  mes: string;
  ingresos: number;
  consumo: number;
  inversion: number;
  discrecional: number;
  movimientos: number;
  /** Ahorro efectivo (incluye lo invertido) sobre ingresos; null si no hubo ingresos. */
  ahorroPct: number | null;
}

export interface Metricas {
  meses: number;
  mesesCompletos: string[];
  serie: FilaMes[];
  ingresos: number;
  consumo: number;
  inversion: number;
  ahorroPositivoFrac: number | null;
  volAhorro: number | null;
  mpc: number | null;
  autocorreccion: { picos: number; ratio: number | null };
  cobro: { dia: number | null; efecto: number | null; tercios: [number, number, number] | null };
  semana: number[];
  diaPico: number | null;
  ticket: { mediana: number; p90: number; topPct: number; porSemana: number };
  rutina: { cobertura: number; comercios: number; recurrentesPct: number | null; top3Pct: number | null };
  entropia: number | null;
  colchon: { acumulado: number; mesesCubiertos: number | null };
  mitades: { ahorro: [number, number]; discrecional: [number, number]; gastoCrece: number; ingresoCrece: number } | null;
  planificado: { mesesConInversion: number; regular: boolean };
  /** Mes con más consumo, para preguntas concretas. */
  mesPico: string | null;
}

export function medir(txs: Tx[], hoy: string): Metricas {
  const gastos = txs.filter((t) => t.type === 'expense');
  const ingresos = txs.filter((t) => t.type === 'income');
  const consumo = gastos.filter((t) => t.categoryId !== 'investing');
  const todosMeses = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();
  const actual = hoy.slice(0, 7);
  const otros = todosMeses.filter((m) => m !== actual);
  // El mes en curso está incompleto: se excluye de las series si hay otros meses.
  const mesesCompletos = otros.length >= 2 ? otros : todosMeses;

  const serie: FilaMes[] = mesesCompletos.map((mes) => {
    const g = gastos.filter((t) => t.date.startsWith(mes));
    const ing = sum(ingresos.filter((t) => t.date.startsWith(mes)).map((t) => t.amountMinor));
    const inv = sum(g.filter((t) => t.categoryId === 'investing').map((t) => t.amountMinor));
    const cons = sum(g.map((t) => t.amountMinor)) - inv;
    return {
      mes, ingresos: ing, consumo: cons, inversion: inv,
      discrecional: sum(g.filter((t) => DISCRECIONAL.includes(t.categoryId)).map((t) => t.amountMinor)),
      movimientos: txs.filter((t) => t.date.startsWith(mes)).length,
      ahorroPct: ing > 0 ? (ing - cons) / ing : null,
    };
  });

  const conIngreso = serie.filter((f) => f.ahorroPct !== null);
  const ahorros = conIngreso.map((f) => f.ahorroPct as number);

  // Propensión marginal a consumir: cuánto de cada euro extra de ingreso se gasta (Keynes / Friedman).
  let mpc: number | null = null;
  if (conIngreso.length >= 4) {
    let num = 0, den = 0;
    for (let i = 1; i < conIngreso.length; i++) {
      const dI = conIngreso[i]!.ingresos - conIngreso[i - 1]!.ingresos;
      const dC = conIngreso[i]!.consumo - conIngreso[i - 1]!.consumo;
      num += dI * dC; den += dI * dI;
    }
    const mi = media(conIngreso.map((f) => f.ingresos));
    const cvIng = mi ? desv(conIngreso.map((f) => f.ingresos)) / mi : 0;
    if (den > 0 && cvIng >= 0.08) mpc = Math.max(-0.5, Math.min(1.5, num / den));
  }

  // Autocorrección: tras un mes de gasto alto, ¿el siguiente compensa?
  const cons = serie.map((f) => f.consumo);
  const mediaCons = media(cons);
  const ratios: number[] = [];
  let picos = 0;
  for (let i = 0; i < cons.length - 1; i++) {
    if (mediaCons > 0 && cons[i]! > mediaCons * 1.15) { picos++; ratios.push(cons[i + 1]! / mediaCons); }
  }
  const autocorreccion = { picos, ratio: ratios.length ? media(ratios) : null };

  // Día de cobro y ritmo dentro del ciclo.
  const dias: number[] = [];
  for (const mes of mesesCompletos) {
    const del = ingresos.filter((t) => t.date.startsWith(mes));
    if (del.length) dias.push(Number(del.reduce((a, b) => (b.amountMinor > a.amountMinor ? b : a)).date.slice(8, 10)));
  }
  const diaCobro = dias.length >= 2 ? Math.round(mediana(dias)) : null;
  let efecto: number | null = null;
  let tercios: [number, number, number] | null = null;
  if (diaCobro !== null) {
    const off = (t: Tx): number => (Number(t.date.slice(8, 10)) - diaCobro + 31) % 31;
    const disc = consumo.filter((t) => DISCRECIONAL.includes(t.categoryId));
    if (disc.length >= 8) {
      const total = sum(disc.map((t) => t.amountMinor));
      const primera = sum(disc.filter((t) => off(t) < 7).map((t) => t.amountMinor));
      efecto = total ? primera / total / (7 / 31) : null;
    }
    const coti = consumo.filter((t) => COTIDIANO.includes(t.categoryId));
    const tot = sum(coti.map((t) => t.amountMinor));
    if (coti.length >= 15 && tot) {
      const a = sum(coti.filter((t) => off(t) < 10).map((t) => t.amountMinor)) / tot;
      const b = sum(coti.filter((t) => off(t) >= 10 && off(t) < 20).map((t) => t.amountMinor)) / tot;
      tercios = [a, b, Math.max(0, 1 - a - b)];
    }
  }

  // Día de la semana.
  const semana = [0, 0, 0, 0, 0, 0, 0];
  for (const t of consumo.filter((x) => COTIDIANO.includes(x.categoryId))) {
    const wd = (new Date(`${t.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    semana[wd]! += t.amountMinor;
  }
  const totSem = sum(semana);
  const semanaPct = semana.map((v) => (totSem ? v / totSem : 0));
  const diaPico = totSem && consumo.length >= 20 ? semanaPct.indexOf(Math.max(...semanaPct)) : null;

  // Distribución de importes.
  const importes = consumo.map((t) => t.amountMinor).sort((a, b) => b - a);
  const nTop = Math.max(1, Math.ceil(importes.length * 0.05));
  const totC = sum(importes);
  const semanas = Math.max(4, todosMeses.length * 4.3);
  const ticket = { mediana: mediana(importes), p90: percentil(importes, 0.9), topPct: totC ? sum(importes.slice(0, nTop)) / totC : 0, porSemana: consumo.length / semanas };

  // Rutina: comercios que se repiten mes tras mes.
  const porComercio = new Map<string, { suma: number; meses: Set<string> }>();
  let conNota = 0;
  for (const t of consumo) {
    const k = merchantKey(t.note)?.key;
    if (!k) continue;
    conNota += t.amountMinor;
    const c = porComercio.get(k) ?? { suma: 0, meses: new Set<string>() };
    c.suma += t.amountMinor; c.meses.add(t.date.slice(0, 7));
    porComercio.set(k, c);
  }
  const cobertura = totC ? conNota / totC : 0;
  const minMeses = Math.max(3, Math.ceil(todosMeses.length * 0.5));
  const lista = [...porComercio.values()].sort((a, b) => b.suma - a.suma);
  const rutina = {
    cobertura,
    comercios: porComercio.size,
    recurrentesPct: cobertura >= 0.4 && conNota ? sum(lista.filter((c) => c.meses.size >= minMeses).map((c) => c.suma)) / conNota : null,
    top3Pct: cobertura >= 0.4 && conNota ? sum(lista.slice(0, 3).map((c) => c.suma)) / conNota : null,
  };

  // Diversificación del gasto (entropía normalizada de Shannon).
  const porCat = new Map<string, number>();
  for (const t of consumo) porCat.set(t.categoryId, (porCat.get(t.categoryId) ?? 0) + t.amountMinor);
  const k = [...porCat.values()].filter((v) => v > 0);
  const entropia = k.length >= 3 && totC ? -sum(k.map((v) => (v / totC) * Math.log(v / totC))) / Math.log(k.length) : null;

  // Colchón observado: lo acumulado en el periodo (no incluye saldos previos).
  const I = sum(ingresos.map((t) => t.amountMinor));
  const inv = sum(gastos.filter((t) => t.categoryId === 'investing').map((t) => t.amountMinor));
  const acumulado = I - totC;
  const consumoMes = totC / Math.max(1, todosMeses.length);
  const colchon = { acumulado, mesesCubiertos: consumoMes > 0 ? acumulado / consumoMes : null };

  // Primera mitad frente a segunda.
  let mitades: Metricas['mitades'] = null;
  if (conIngreso.length >= 4) {
    const h = Math.floor(conIngreso.length / 2);
    const a = conIngreso.slice(0, h), b = conIngreso.slice(-h);
    const tasa = (xs: FilaMes[]): number => { const i = sum(xs.map((f) => f.ingresos)); return i ? (i - sum(xs.map((f) => f.consumo))) / i : 0; };
    const disc = (xs: FilaMes[]): number => { const c = sum(xs.map((f) => f.consumo)); return c ? sum(xs.map((f) => f.discrecional)) / c : 0; };
    const crece = (x: number, y: number): number => (x ? (y - x) / x : 0);
    mitades = {
      ahorro: [tasa(a), tasa(b)], discrecional: [disc(a), disc(b)],
      gastoCrece: crece(media(a.map((f) => f.consumo)), media(b.map((f) => f.consumo))),
      ingresoCrece: crece(media(a.map((f) => f.ingresos)), media(b.map((f) => f.ingresos))),
    };
  }

  const invMes = serie.map((f) => f.inversion);
  const mesesConInversion = invMes.filter((v) => v > 0).length;
  const planificado = {
    mesesConInversion,
    regular: serie.length >= 3 && mesesConInversion / serie.length >= 0.6 && media(invMes.filter((v) => v > 0)) > 0 && desv(invMes.filter((v) => v > 0)) / media(invMes.filter((v) => v > 0)) < 0.5,
  };

  const mesPico = serie.length >= 3 ? serie.reduce((a, b) => (b.consumo > a.consumo ? b : a)).mes : null;

  return {
    meses: todosMeses.length, mesesCompletos, serie, ingresos: I, consumo: totC, inversion: inv,
    ahorroPositivoFrac: ahorros.length ? ahorros.filter((a) => a > 0).length / ahorros.length : null,
    volAhorro: ahorros.length >= 3 ? desv(ahorros) : null,
    mpc, autocorreccion,
    cobro: { dia: diaCobro, efecto, tercios },
    semana: semanaPct, diaPico, ticket, rutina, entropia, colchon, mitades, planificado, mesPico,
  };
}

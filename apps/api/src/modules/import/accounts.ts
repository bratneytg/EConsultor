import type { Transaction } from '@econsultor/shared';
import { addDays } from '../../lib/dates.js';
import { merchantKey } from './merchant.js';

/** Nombre de cuenta normalizado: sin espacios de más y sin distinguir mayúsculas al comparar. */
export const normAccount = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
export const sameAccount = (a: string | undefined, b: string | undefined): boolean => normAccount(a).toLowerCase() === normAccount(b).toLowerCase();

export interface Candidate { date: string; type: 'income' | 'expense'; amountMinor: number; note: string }

const daysBetween = (a: string, b: string): number => Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** ¿Pueden ser el mismo comercio? Si algún lado no tiene nombre reconocible, no se descarta. */
function namesCompatible(a: string, b: string | undefined): boolean {
  const ka = merchantKey(a)?.key;
  const kb = merchantKey(b)?.key;
  if (!ka || !kb) return true;
  return ka === kb || ka.startsWith(kb) || kb.startsWith(ka);
}

/**
 * Empareja cada candidato con, como mucho, un movimiento ya guardado (multiconjunto: dos cafés iguales el mismo
 * día necesitan dos movimientos guardados). Mismo tipo e importe, fecha dentro de la tolerancia y, si se pide,
 * nombre compatible. Devuelve índice del candidato → movimiento.
 */
export function matchAgainst(
  items: Candidate[],
  pool: Transaction[],
  opts: { tolDays: number; names: boolean; skip?: Set<number>; opposite?: boolean },
): Map<number, Transaction> {
  const idx = new Map<string, Transaction[]>();
  for (const t of pool) {
    const k = `${t.type}|${t.amountMinor}`;
    (idx.get(k) ?? idx.set(k, []).get(k)!).push(t);
  }
  const used = new Set<string>();
  const out = new Map<number, Transaction>();
  items.forEach((it, i) => {
    if (opts.skip?.has(i)) return;
    const type = opts.opposite ? (it.type === 'income' ? 'expense' : 'income') : it.type;
    const list = idx.get(`${type}|${it.amountMinor}`);
    if (!list) return;
    let best: Transaction | undefined;
    let bestGap = Infinity;
    for (const t of list) {
      if (used.has(t.id)) continue;
      const gap = daysBetween(t.date, it.date);
      if (gap > opts.tolDays || gap >= bestGap) continue;
      if (opts.names && !namesCompatible(it.note, t.note)) continue;
      best = t;
      bestGap = gap;
    }
    if (best) { used.add(best.id); out.set(i, best); }
  });
  return out;
}

export interface Overlap {
  /** Cuenta con la que coincide (cadena vacía = la principal). */
  account: string;
  matched: number;
  total: number;
}

/** ¿Coincide tanto con una cuenta existente que casi seguro es el mismo extracto? */
export function isSameStatement(matched: number, total: number): boolean {
  return total > 0 && ((matched >= 4 && matched / total >= 0.6) || (matched >= 3 && matched === total));
}

export const windowAround = (from: string, to: string, days = 3): { from: string; to: string } => ({ from: addDays(from, -days), to: addDays(to, days) });

/** Palabras que indican un traspaso entre cuentas propias. */
export const TRANSFER_CUE = /(bonifico|giroconto|trasferimento|ueberweisung|umbuchung|transferencia|traspaso|transfer\b|eigenes konto)/;

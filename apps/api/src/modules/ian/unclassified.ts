import type { Transaction } from '@econsultor/shared';
import { scrub } from '../import/ai.js';
import { norm } from '../import/parse.js';

/** Los gastos que quedaron en «Otros»: lo que ni las reglas ni la persona han clasificado. */
export const UNCLASSIFIED = 'other_expense';

export interface MerchantGroup {
  /** Nombre tal como se le enseña a Ian y como luego se le pide reclasificar. */
  label: string;
  txs: Transaction[];
  totalMinor: number;
  lastDate: string;
}

/**
 * Clave exacta del comercio: el texto de la nota sin cifras ni signos. Más estricta que `merchantKey` (que usa solo la primera
 * palabra y mezclaría «Zum Hirschen» con «Zum Ochsen»): aquí un cambio masivo solo alcanza a cargos del MISMO comercio.
 */
export function exactKey(note: string | undefined): string {
  const first = (note ?? '').split('·')[0] ?? '';
  return norm(first).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function unclassifiedGroups(txs: Transaction[]): { groups: MerchantGroup[]; noNote: number; count: number; totalMinor: number } {
  const by = new Map<string, MerchantGroup>();
  let noNote = 0, count = 0, totalMinor = 0;
  for (const t of txs) {
    if (t.type !== 'expense' || t.categoryId !== UNCLASSIFIED) continue;
    count++; totalMinor += t.amountMinor;
    const key = exactKey(t.note);
    if (key.length < 3) { noNote++; continue; }
    const g = by.get(key) ?? { label: scrub((t.note ?? '').split('·')[0] ?? '').replace(/\s+\d[\d\s]*$/, '').trim().slice(0, 40), txs: [], totalMinor: 0, lastDate: '' };
    g.txs.push(t); g.totalMinor += t.amountMinor; if (t.date > g.lastDate) g.lastDate = t.date;
    by.set(key, g);
  }
  return { groups: [...by.values()].sort((a, b) => b.totalMinor - a.totalMinor), noNote, count, totalMinor };
}

/** ¿Merece la pena sacar el tema? Con muy pocos movimientos sin clasificar sería un incordio. */
export const worthAsking = (u: { groups: MerchantGroup[]; count: number }): boolean => u.groups.length > 0 && u.count >= 3;

/** Se saca el tema como mucho una vez al día por cuenta, para que sea casual y no un interrogatorio. En memoria. */
const nudged = new Map<string, string>();
export const canNudge = (userId: string, day: string): boolean => nudged.get(userId) !== day;
export const markNudged = (userId: string, day: string): void => { nudged.set(userId, day); };
export const _resetNudges = (): void => nudged.clear();

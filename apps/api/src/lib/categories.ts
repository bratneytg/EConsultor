import { randomBytes } from 'node:crypto';
import { CATEGORIES, categoryById, registerCategories, unregisterCategory, userHasCategory, type Category, type CategoryPrefs, type TxType } from '@econsultor/shared';
import type { UserRecord } from '../store/types.js';
import { badRequest } from './errors.js';
import { tr } from './i18n.js';

export const prefsOf = (u: Pick<UserRecord, 'categoryPrefs'>): CategoryPrefs => ({
  custom: u.categoryPrefs?.custom ?? [],
  renamed: u.categoryPrefs?.renamed ?? {},
  hidden: u.categoryPrefs?.hidden ?? [],
});

/** Las categorías propias de cada cuenta se conocen en todo el servidor (los consejos las necesitan para clasificar). */
export const registerUserCategories = (u: Pick<UserRecord, 'categoryPrefs'>): void => registerCategories(u.categoryPrefs?.custom);

/** Nombre que la persona ve: el que haya puesto, el de su categoría propia, o el de serie traducido. */
export function categoryLabelFor(prefs: CategoryPrefs, id: string): string {
  const renamed = prefs.renamed[id];
  if (renamed) return renamed;
  const own = prefs.custom.find((c) => c.id === id);
  if (own) return own.label;
  return tr(categoryById(id)?.label ?? id);
}

/** La categoría debe existir para esta cuenta y corresponder al tipo del movimiento. */
export function assertCategory(u: Pick<UserRecord, 'categoryPrefs'>, id: string, type: TxType): Category {
  const c = userHasCategory(prefsOf(u), id);
  if (!c) throw badRequest('Esa categoría no existe', 'unknown_category');
  if (c.type !== type) throw badRequest('La categoría no corresponde al tipo', 'category_type');
  return c;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newCustomId(): string {
  for (;;) {
    const id = `c_${Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
    if (!categoryById(id)) return id;
  }
}

/** Categoría «de reserva» a la que pasan los movimientos cuando se borra una categoría propia. */
export const fallbackCategory = (type: TxType): string => (type === 'income' ? 'other_income' : 'other_expense');

/** Nombres que se pueden usar para repartir un gasto o un ingreso, tal como los ve la persona. */
export function visibleLabels(prefs: CategoryPrefs, type: TxType): string[] {
  const hidden = new Set(prefs.hidden);
  const builtin = CATEGORIES.filter((c) => c.type === type && !hidden.has(c.id)).map((c) => categoryLabelFor(prefs, c.id));
  const own = prefs.custom.filter((c) => c.type === type).map((c) => c.label);
  return [...builtin, ...own];
}

export const unregisterAll = (ids: string[]): void => { for (const id of ids) unregisterCategory(id); };

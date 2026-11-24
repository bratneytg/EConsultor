import { CATEGORIES, categoryById, type Category } from '@econsultor/shared';

/**
 * El color sigue a la ENTIDAD, nunca a su posición en un ranking: cada categoría pertenece a una
 * "familia" con un hueco fijo de la paleta categórica (orden validado). Así "Hogar" es siempre azul.
 * 7 familias + "Otros" (gris) — nunca se genera un noveno matiz.
 */
export interface Family { id: string; label: string; color: string; darkText?: boolean }

export const FAMILIES: Family[] = [
  { id: 'home', label: 'Hogar', color: 'var(--s1)' },
  { id: 'food', label: 'Comida', color: 'var(--s2)' },
  { id: 'move', label: 'Movilidad', color: 'var(--s3)' },
  { id: 'subs', label: 'Suscripciones', color: 'var(--s4)', darkText: true },
  { id: 'fun', label: 'Ocio y viajes', color: 'var(--s5)' },
  { id: 'shop', label: 'Compras', color: 'var(--s6)' },
  { id: 'care', label: 'Salud y formación', color: 'var(--s7)' },
  { id: 'other', label: 'Otros', color: 'var(--s-other)' },
];

const FAMILY_OF: Record<string, string> = {
  housing: 'home', utilities: 'home', insurance: 'home', debt: 'home',
  groceries: 'food', dining: 'food',
  transport: 'move',
  subscriptions: 'subs',
  leisure: 'fun', travel: 'fun',
  shopping: 'shop',
  health: 'care', education: 'care',
  other_expense: 'other',
};

export const familyOf = (categoryId: string): Family =>
  FAMILIES.find((f) => f.id === FAMILY_OF[categoryId]) ?? FAMILIES[FAMILIES.length - 1]!;

export const categoryLabel = (id: string): string => categoryById(id)?.label ?? id;

/** Color de un movimiento: ingresos siempre en el color de "ingreso", gastos en el de su familia. */
export const categoryColor = (id: string): string =>
  categoryById(id)?.type === 'income' ? 'var(--income)' : familyOf(id).color;

export const EXPENSE_CATEGORIES: Category[] = CATEGORIES.filter((c) => c.type === 'expense') as Category[];
export const INCOME_CATEGORIES: Category[] = CATEGORIES.filter((c) => c.type === 'income') as Category[];

import { CATEGORIES, CUSTOM_CATEGORY_ICONS, categoryById, categoryFamily, registerCategories, type Category, type CategoryPrefs } from '@econsultor/shared';
import { CATEGORY_ICON, type IconName } from '../components/Icon';
import { t } from './i18n';

/**
 * El color sigue a la ENTIDAD, nunca a su posición en un ranking: cada categoría pertenece a una
 * "familia" con un hueco fijo de la paleta categórica (orden validado). Así "Hogar" es siempre azul.
 * 7 familias + "Otros" (gris) — nunca se genera un noveno matiz.
 */
export interface Family { id: string; readonly label: string; color: string; darkText?: boolean }

export const FAMILIES: Family[] = [
  { id: 'home', get label() { return t('Hogar'); }, color: 'var(--s1)' },
  { id: 'food', get label() { return t('Comida'); }, color: 'var(--s2)' },
  { id: 'move', get label() { return t('Movilidad'); }, color: 'var(--s3)' },
  { id: 'subs', get label() { return t('Suscripciones'); }, color: 'var(--s4)', darkText: true },
  { id: 'fun', get label() { return t('Ocio y viajes'); }, color: 'var(--s5)' },
  { id: 'shop', get label() { return t('Compras'); }, color: 'var(--s6)' },
  { id: 'care', get label() { return t('Salud y formación'); }, color: 'var(--s7)' },
  { id: 'other', get label() { return t('Otros'); }, color: 'var(--s-other)' },
];

export const familyOf = (categoryId: string): Family =>
  FAMILIES.find((f) => f.id === categoryFamily(categoryId)) ?? FAMILIES[FAMILIES.length - 1]!;

// ───────── Personalización de la cuenta (categorías propias, nombres cambiados, ocultas) ─────────
let prefs: CategoryPrefs = { custom: [], renamed: {}, hidden: [] };

/** Se llama cada vez que cambia el usuario: así las etiquetas, colores y listas siempre están al día. */
export function applyCategoryPrefs(p: CategoryPrefs | undefined): void {
  prefs = { custom: p?.custom ?? [], renamed: p?.renamed ?? {}, hidden: p?.hidden ?? [] };
  registerCategories(prefs.custom, true);
}
export const categoryPrefs = (): CategoryPrefs => prefs;

/** Nombre de la categoría: el que puso la persona o, si no, el de serie en el idioma de la app. */
export const categoryLabel = (id: string): string => prefs.renamed[id] ?? prefs.custom.find((c) => c.id === id)?.label ?? t(categoryById(id)?.label ?? id);

/** Icono de la categoría: el que eligió la persona para la suya, o el de serie. */
export const categoryIcon = (id: string): IconName => (prefs.custom.find((c) => c.id === id)?.icon as IconName | undefined) ?? CATEGORY_ICON[id] ?? 'dots';

/** Nombre corto de cada icono elegible, para el selector de «Nueva categoría». */
export const ICON_LABELS: Record<(typeof CUSTOM_CATEGORY_ICONS)[number], string> = {
  home: 'Casa', bolt: 'Energía', umbrella: 'Seguro', card: 'Tarjeta', repeat: 'Suscripción',
  cart: 'Compra', fork: 'Comida', car: 'Coche', plane: 'Viaje', bag: 'Bolsa', ticket: 'Entradas',
  heart: 'Salud', book: 'Estudios', briefcase: 'Trabajo', wallet: 'Cartera', trend: 'Inversión',
  gift: 'Regalo', dumbbell: 'Deporte', paw: 'Mascotas', music: 'Música', gear: 'Mantenimiento',
  phone: 'Tecnología', trophy: 'Aficiones', dots: 'Otro',
};

/** ¿Existe esta categoría para la persona? (las de serie y las suyas). */
export const knownCategory = (id: string): boolean => !!categoryById(id);

/** Color de un movimiento: ingresos siempre en el color de "ingreso", gastos en el de su familia. */
export const categoryColor = (id: string): string =>
  categoryById(id)?.type === 'income' ? 'var(--income)' : familyOf(id).color;

const listFor = (type: 'expense' | 'income', keep: string[]): Category[] => {
  const serie = CATEGORIES.filter((c) => c.type === type && (!prefs.hidden.includes(c.id) || keep.includes(c.id)));
  const own = prefs.custom.filter((c) => c.type === type).map((c) => categoryById(c.id)!).filter(Boolean);
  // «Otros» siempre al final.
  const other = type === 'expense' ? 'other_expense' : 'other_income';
  return [...serie.filter((c) => c.id !== other), ...own, ...serie.filter((c) => c.id === other)] as Category[];
};
/** Categorías que se pueden elegir. `keep`: las que se muestran aunque estén ocultas (p. ej. la de un movimiento que se edita). */
export const expenseCategories = (keep: string[] = []): Category[] => listFor('expense', keep);
export const incomeCategories = (keep: string[] = []): Category[] => listFor('income', keep);
/** Todas, sin ocultar ninguna (filtros y listas de revisión). */
export const allExpenseCategories = (): Category[] => listFor('expense', CATEGORIES.map((c) => c.id));
export const allIncomeCategories = (): Category[] => listFor('income', CATEGORIES.map((c) => c.id));

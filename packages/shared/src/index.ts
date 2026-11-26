/**
 * Contrato compartido entre API y web.
 * Regla de oro: el dinero SIEMPRE son enteros en la unidad menor (céntimos).
 */
import { z } from 'zod';

// ───────────────────────────── Categorías ─────────────────────────────

export type TxType = 'income' | 'expense';

export interface Category {
  id: string;
  label: string;
  type: TxType;
  /** Gasto fijo/recurrente (vivienda, seguros…) frente a variable. Lo usa el perfil financiero. */
  fixed?: boolean;
  /** Gasto discrecional (ocio, restaurantes…). */
  discretionary?: boolean;
  /** Categoría creada por la persona (id `c_…`). */
  custom?: boolean;
  /** Familia de color (solo categorías propias; las de serie ya tienen la suya). */
  family?: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'housing', label: 'Vivienda', type: 'expense', fixed: true },
  { id: 'utilities', label: 'Suministros', type: 'expense', fixed: true },
  { id: 'insurance', label: 'Seguros', type: 'expense', fixed: true },
  { id: 'debt', label: 'Deudas y préstamos', type: 'expense', fixed: true },
  { id: 'subscriptions', label: 'Suscripciones', type: 'expense', fixed: true, discretionary: true },
  { id: 'groceries', label: 'Supermercado', type: 'expense' },
  { id: 'transport', label: 'Transporte', type: 'expense' },
  { id: 'health', label: 'Salud', type: 'expense' },
  { id: 'education', label: 'Formación', type: 'expense' },
  { id: 'dining', label: 'Restaurantes', type: 'expense', discretionary: true },
  { id: 'leisure', label: 'Ocio', type: 'expense', discretionary: true },
  { id: 'shopping', label: 'Compras', type: 'expense', discretionary: true },
  { id: 'travel', label: 'Viajes', type: 'expense', discretionary: true },
  { id: 'investing', label: 'Inversión y ahorro', type: 'expense' },
  { id: 'other_expense', label: 'Otros gastos', type: 'expense' },
  { id: 'salary', label: 'Nómina', type: 'income' },
  { id: 'freelance', label: 'Trabajo extra', type: 'income' },
  { id: 'investments', label: 'Inversiones', type: 'income' },
  { id: 'gifts', label: 'Regalos', type: 'income' },
  { id: 'refunds', label: 'Devoluciones', type: 'income' },
  { id: 'other_income', label: 'Otros ingresos', type: 'income' },
] as const;

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [string, ...string[]];

/**
 * Categorías propias. Sus ids son aleatorios (`c_…`) y únicos, así que un registro compartido no mezcla
 * a unas personas con otras: en la web solo hay una persona; en el servidor se registran las de todas
 * y cada petición solo acepta las ids de su propia cuenta (ver `userHasCategory`).
 */
const customRegistry = new Map<string, Category>();
export const FAMILY_IDS = ['home', 'food', 'move', 'subs', 'fun', 'shop', 'care', 'other'] as const;
export const CUSTOM_ID = /^c_[a-z0-9]{8}$/;
export const MAX_CUSTOM_CATEGORIES = 40;
export const CATEGORY_LABEL_MAX = 30;

export interface CustomCategory {
  id: string;
  label: string;
  type: TxType;
  family?: (typeof FAMILY_IDS)[number];
  fixed?: boolean;
  discretionary?: boolean;
}
/** Personalización de categorías de una cuenta: propias, nombres cambiados a las de serie y las que se ocultan al añadir. */
export interface CategoryPrefs {
  custom: CustomCategory[];
  renamed: Record<string, string>;
  hidden: string[];
}
export const EMPTY_CATEGORY_PREFS: CategoryPrefs = { custom: [], renamed: {}, hidden: [] };

/** Sustituye las categorías propias que se conocen de una cuenta (o las añade al registro del servidor). */
export function registerCategories(list: readonly CustomCategory[] | undefined, replaceAll = false): void {
  if (replaceAll) customRegistry.clear();
  for (const c of list ?? []) customRegistry.set(c.id, { id: c.id, label: c.label, type: c.type, fixed: c.fixed, discretionary: c.discretionary, custom: true, family: c.family });
}
export const unregisterCategory = (id: string): void => { customRegistry.delete(id); };

/** Familia de color de las categorías de serie (el color sigue a la entidad, nunca al puesto en un ranking). */
const FAMILY_OF: Record<string, (typeof FAMILY_IDS)[number]> = {
  housing: 'home', utilities: 'home', insurance: 'home', debt: 'home',
  groceries: 'food', dining: 'food',
  transport: 'move',
  subscriptions: 'subs',
  leisure: 'fun', travel: 'fun',
  shopping: 'shop',
  health: 'care', education: 'care',
  investing: 'other',
  other_expense: 'other',
};
/** Familia de una categoría: la de serie, la que eligió la persona para la suya o «other». */
export const categoryFamily = (id: string): (typeof FAMILY_IDS)[number] => {
  const f = FAMILY_OF[id] ?? customRegistry.get(id)?.family;
  return (FAMILY_IDS as readonly string[]).includes(f ?? '') ? (f as (typeof FAMILY_IDS)[number]) : 'other';
};

export const categoryById = (id: string): Category | undefined => CATEGORIES.find((c) => c.id === id) ?? customRegistry.get(id);
/** ¿La cuenta puede usar esta categoría? De serie, siempre; las propias, solo las suyas. */
export const userHasCategory = (prefs: CategoryPrefs | undefined, id: string): Category | undefined =>
  CATEGORIES.find((c) => c.id === id) ??
  (prefs?.custom.find((c) => c.id === id) ? categoryById(id) : undefined);

const categoryLabelText = z.string().trim().min(1, 'Escribe un nombre').max(CATEGORY_LABEL_MAX, 'Máximo 30 letras');
export const categoryPrefsInput = z.object({
  custom: z
    .array(
      z.object({
        id: z.string().regex(CUSTOM_ID).optional(),
        label: categoryLabelText,
        type: z.enum(['income', 'expense']),
        family: z.enum(FAMILY_IDS).optional(),
        fixed: z.boolean().optional(),
        discretionary: z.boolean().optional(),
      }),
    )
    .max(MAX_CUSTOM_CATEGORIES, 'Demasiadas categorías propias')
    .default([]),
  renamed: z.record(z.string().max(40), categoryLabelText).default({}),
  hidden: z.array(z.string().max(40)).max(60).default([]),
});
export type CategoryPrefsInput = z.infer<typeof categoryPrefsInput>;

// ───────────────────────────── Esquemas ─────────────────────────────

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (YYYY-MM)');

export const transactionInput = z
  .object({
    type: z.enum(['income', 'expense']),
    amountMinor: z.number().int().positive().max(10_000_000_000),
    currency: z.string().length(3).toUpperCase().default('EUR'),
    categoryId: z.string().min(1).max(40),
    note: z.string().trim().max(200).optional(),
    date: isoDate,
    /** Cuenta o tarjeta de origen («Nexi», «Ahorro»…). Ausente = cuenta principal. */
    account: z.string().trim().max(40).optional(),
  })
  .superRefine((v, ctx) => {
    // Si no se conoce (puede ser propia de la cuenta), la ruta la valida con `userHasCategory`.
    const cat = categoryById(v.categoryId);
    if (cat && cat.type !== v.type) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'La categoría no corresponde al tipo' });
    }
  });
export type TransactionInput = z.infer<typeof transactionInput>;

export interface Transaction extends TransactionInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Si lo generó un gasto o ingreso periódico, el id de este. */
  recurringId?: string;
}

// ───────────────────────────── Periódicos ─────────────────────────────

export const MAX_RECURRING = 60;

/** Gasto o ingreso que se repite cada mes (alquiler, transporte, Netflix, nómina…). */
export const recurringInput = z
  .object({
    type: z.enum(['income', 'expense']),
    amountMinor: z.number().int().positive().max(10_000_000_000),
    categoryId: z.string().min(1).max(40),
    name: z.string().trim().min(1, 'Escribe un nombre').max(60),
    /** Día del mes en que se cobra o se paga. Si el mes es más corto, el último día. */
    day: z.number().int().min(1).max(31),
    /** Primer mes en que se anota. Ausente: este mes si el día aún no ha pasado, o el próximo. */
    startMonth: monthStr.optional(),
    /** Último mes (opcional): para cuotas o contratos que terminan. */
    endMonth: monthStr.optional().nullable(),
    account: z.string().trim().max(40).optional(),
    active: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const cat = categoryById(v.categoryId);
    if (cat && cat.type !== v.type) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'La categoría no corresponde al tipo' });
    if (v.startMonth && v.endMonth && v.endMonth < v.startMonth) ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'El último mes no puede ser anterior al primero' });
  });
export type RecurringInput = z.infer<typeof recurringInput>;

export interface Recurring {
  id: string;
  type: TxType;
  amountMinor: number;
  categoryId: string;
  name: string;
  day: number;
  startMonth: string;
  endMonth?: string;
  account?: string;
  active: boolean;
  /** Último mes ya anotado (YYYY-MM). */
  lastGenerated?: string;
  createdAt: string;
  /** Próxima fecha de cargo (solo en las respuestas de la API). */
  nextDate?: string;
}

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10, 'Mínimo 10 caracteres').max(128);

export const registerInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(60),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
});
/** Interfaz: «simple» (resumen y pocos gráficos) o «pro» (análisis completo). */
export const uiModeSchema = z.enum(['simple', 'pro']);
export type UiMode = z.infer<typeof uiModeSchema>;

/** Usuario de la cuenta maestra de pruebas: la única excepción a «el acceso es con email». */
export const MASTER_LOGIN = 'admin';

/** El acceso exige un email válido; solo la cuenta maestra se identifica sin él. */
export const loginInput = z.object({
  identifier: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === MASTER_LOGIN || emailSchema.safeParse(v).success, 'Introduce un email válido'),
  password: z.string().min(1).max(128),
});
export const mfaVerifyInput = z
  .object({
    mfaToken: z.string().min(10),
    code: z.string().trim().regex(/^\d{6}$/).optional(),
    recoveryCode: z.string().trim().min(8).max(32).optional(),
  })
  .refine((v) => !!v.code !== !!v.recoveryCode, { message: 'Indica code o recoveryCode' });
/** Minutos de inactividad tras los que se cierra la sesión (salvo «Mantener conectado»). */
export const IDLE_TIMEOUT_MIN = 10;

export const googleInput = z.object({ idToken: z.string().min(20) });

/** Idiomas de la app. `en` es el predeterminado. */
export const LANGUAGES = ['en', 'es', 'it', 'de'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const DEFAULT_LANG: Lang = 'en';
export const langSchema = z.enum(LANGUAGES);

export const settingsInput = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    currency: z.string().length(3).toUpperCase(),
    timezone: z.string().min(1).max(64),
    reminderEnabled: z.boolean(),
    reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    uiMode: uiModeSchema,
    keepSignedIn: z.boolean(),
    language: langSchema,
  })
  .partial();
export type SettingsInput = z.infer<typeof settingsInput>;

// ───────────────────────────── Respuestas de API ─────────────────────────────

export type Plan = 'free' | 'premium';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  plan: Plan;
  currency: string;
  timezone: string;
  reminderEnabled: boolean;
  reminderTime: string;
  uiMode: UiMode;
  /** true → la sesión no se cierra tras 10 min de inactividad. */
  keepSignedIn: boolean;
  /** Llaves de acceso (huella) registradas. */
  /** Dispositivos con huella: `passkey` = llave del navegador (WebAuthn); `app` = huella nativa de la app de Android. */
  /** Idioma elegido; las cuentas antiguas que aún no lo han elegido reciben `en`. */
  language: Lang;
  /** Categorías propias, nombres cambiados y categorías ocultas. */
  categoryPrefs: CategoryPrefs;
  passkeys: { id: string; name: string; kind: 'passkey' | 'app'; createdAt: string; lastUsedAt?: string }[];
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
}

export type AuthResponse =
  | { mfaRequired: false; accessToken: string; user: PublicUser }
  | { mfaRequired: true; mfaToken: string };

export interface CategoryTotal {
  categoryId: string;
  amountMinor: number;
  share: number; // 0..1 sobre el total del tipo
  prevAmountMinor: number;
  count: number;
}

export interface DailyPoint {
  date: string;
  incomeMinor: number;
  expenseMinor: number;
  /** Saldo acumulado del mes (ingresos − gastos hasta ese día). */
  balanceMinor: number;
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  incomeMinor: number;
  expenseMinor: number;
}

export interface HeatDay {
  date: string;
  expenseMinor: number;
}

export interface HealthScore {
  score: number; // 0..100
  label: 'Excelente' | 'Sólida' | 'En construcción' | 'Atención';
  parts: { key: string; label: string; value: number; weight: number; hint: string }[];
}

export interface Overview {
  month: string;
  currency: string;
  today: string;
  totals: { incomeMinor: number; expenseMinor: number; netMinor: number; savingsRate: number };
  prevTotals: { incomeMinor: number; expenseMinor: number };
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  daily: DailyPoint[];
  forecast: {
    daysInMonth: number;
    daysElapsed: number;
    dailyRunRateMinor: number;
    projectedExpenseMinor: number;
    projectedNetMinor: number;
    /** Serie punteada de saldo previsto desde hoy hasta fin de mes. */
    projectedBalance: { date: string; balanceMinor: number }[];
  };
  monthly: MonthlyPoint[]; // últimos 12 meses terminando en `month`
  heatmap: HeatDay[]; // últimos ~17 semanas
  weekday: { weekday: number; avgExpenseMinor: number }[]; // 0 = lunes
  topExpenses: Transaction[];
  health: HealthScore;
  streakDays: number;
  loggedToday: boolean;
}

export type AdviceKind = 'saving' | 'spending' | 'income' | 'habit' | 'risk' | 'win';
export type AdviceSeverity = 'info' | 'tip' | 'warn' | 'win';

export interface Advice {
  id: string;
  kind: AdviceKind;
  severity: AdviceSeverity;
  scope: 'generic' | 'specific';
  title: string;
  body: string;
  /** Impacto mensual estimado en céntimos (si aplica). */
  impactMinor?: number;
  /** Qué hacer, en concreto (solo en los consejos detallados). */
  action?: string;
}

/** Por qué la IA no ha podido responder (solo se muestra a cuentas Premium). */
export type AiIssue = 'no_key' | 'key' | 'model' | 'limit' | 'busy' | 'network' | 'format';

export interface AdviceResponse {
  source: 'rules' | 'ai';
  /** Si la IA debía responder y no lo ha hecho: el motivo, para poder arreglarlo. */
  aiIssue?: AiIssue;
  plan: Plan;
  generatedAt: string;
  items: Advice[];
  /** Cuántos consejos adicionales se desbloquean con Premium. */
  lockedCount: number;
  /** Solo en el análisis detallado: sobre qué datos se ha hecho. */
  basis?: { periodDays: number; txCount: number; merchants: number; aiAvailable: boolean };
}

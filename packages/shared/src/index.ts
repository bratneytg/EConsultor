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
  { id: 'other_expense', label: 'Otros gastos', type: 'expense' },
  { id: 'salary', label: 'Nómina', type: 'income' },
  { id: 'freelance', label: 'Trabajo extra', type: 'income' },
  { id: 'investments', label: 'Inversiones', type: 'income' },
  { id: 'gifts', label: 'Regalos', type: 'income' },
  { id: 'refunds', label: 'Devoluciones', type: 'income' },
  { id: 'other_income', label: 'Otros ingresos', type: 'income' },
] as const;

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [string, ...string[]];
export const categoryById = (id: string): Category | undefined => CATEGORIES.find((c) => c.id === id);

// ───────────────────────────── Esquemas ─────────────────────────────

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (YYYY-MM)');

export const transactionInput = z
  .object({
    type: z.enum(['income', 'expense']),
    amountMinor: z.number().int().positive().max(10_000_000_000),
    currency: z.string().length(3).toUpperCase().default('EUR'),
    categoryId: z.enum(CATEGORY_IDS),
    note: z.string().trim().max(200).optional(),
    date: isoDate,
    /** Cuenta o tarjeta de origen («Nexi», «Ahorro»…). Ausente = cuenta principal. */
    account: z.string().trim().max(40).optional(),
  })
  .superRefine((v, ctx) => {
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

export interface AdviceResponse {
  source: 'rules' | 'ai';
  plan: Plan;
  generatedAt: string;
  items: Advice[];
  /** Cuántos consejos adicionales se desbloquean con Premium. */
  lockedCount: number;
  /** Solo en el análisis detallado: sobre qué datos se ha hecho. */
  basis?: { periodDays: number; txCount: number; merchants: number; aiAvailable: boolean };
}

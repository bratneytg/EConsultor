/** Fila tal como sale del extracto, ya normalizada pero sin categorizar. Importe con signo (gasto < 0). */
export interface RawRow {
  date: string; // YYYY-MM-DD
  amountMinor: number;
  name?: string;
  reference?: string;
  /** Categoría que ya trae el banco (columna «Category» de algunos CSV de N26). */
  bankCategory?: string;
  /** Tipo de operación del banco («Presentment», «Space transfer»…). Solo sirve para detectar traspasos internos. */
  kind?: string;
  /** Dirección indicada por el propio extracto (columna «tipo» o «segno»); solo se usa si los importes no llevan signo. */
  hint?: 'debit' | 'credit';
}

export interface ImportRow {
  id: string;
  date: string;
  type: 'income' | 'expense';
  categoryId: string;
  /** Siempre positivo; el tipo lo da `type`. */
  amountMinor: number;
  note: string;
  confidence: 'high' | 'medium' | 'low';
  via: 'rule' | 'bank' | 'ai' | 'history' | 'default';
  /** Por qué se propone omitirla (el usuario puede forzarla). */
  skip?: 'duplicate' | 'internal' | 'other_account';
  /** Qué es el comercio según la IA («Alquiler de esquís»), si la categoría la propuso ella. */
  hint?: string;
  /** La IA lo buscó en internet para identificarlo. */
  web?: boolean;
}

export interface ImportPreview {
  source: 'csv' | 'pdf' | 'sheet';
  /** `offline`: todo se procesó en el servidor propio. `ai`: se usó Claude para parte del análisis. */
  engine: 'offline' | 'ai';
  rows: ImportRow[];
  stats: { total: number; income: number; expense: number; skipped: number; from: string; to: string; incomeMinor: number; expenseMinor: number };
  warnings: string[];
  /** Cómo se decidió qué es gasto y qué es ingreso. `flipped`: la persona pidió invertirlo. */
  signs: { mode: 'normal' | 'inverted' | 'unsigned'; flipped: boolean };
  /** Cuenta a la que se importa (vacío = la principal) y las que ya tiene la persona. */
  account: string;
  accounts: { name: string; count: number }[];
  /** Casi todo coincide con lo que ya hay en la MISMA cuenta: el extracto ya estaba importado. */
  sameStatement?: { matched: number; total: number };
  /** Qué hizo la IA con lo que las reglas no reconocían (solo si se pidió). */
  ai?: { identified: number; web: number; skippedWeb: number; problem?: 'unavailable' | 'web_unavailable' };
  /** Casi todo coincide con OTRA cuenta: probablemente el mismo extracto. `ignored`: la persona dijo que es otra. */
  overlap?: { account: string; matched: number; total: number; ignored: boolean };
}

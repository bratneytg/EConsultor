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
  via: 'rule' | 'bank' | 'ai' | 'default';
  /** Por qué se propone omitirla (el usuario puede forzarla). */
  skip?: 'duplicate' | 'internal';
}

export interface ImportPreview {
  source: 'csv' | 'pdf';
  /** `offline`: todo se procesó en el servidor propio. `ai`: se usó Claude para parte del análisis. */
  engine: 'offline' | 'ai';
  rows: ImportRow[];
  stats: { total: number; income: number; expense: number; skipped: number; from: string; to: string; incomeMinor: number; expenseMinor: number };
  warnings: string[];
}

import { detectDayFirst, norm, parseAmount, parseDate } from './parse.js';
import type { RawRow } from './types.js';

/** Cabeceras conocidas (sin acentos, en minúsculas). El orden importa: primero lo más específico. */
const H = {
  date: [
    'data operazione', 'data movimento', 'data contabile', 'data transazione', 'data registrazione', 'data', 'data valuta',
    'booking date', 'buchungsdatum', 'buchungstag', 'fecha operacion', 'fecha', 'date', 'transaction date', 'completed date', 'started date', 'datum', 'valuta', 'wertstellung',
  ],
  amount: [
    'importo in eur', 'importo eur', 'importo in euro', 'importo (eur)', 'importo euro', 'importo', 'amount (eur)', 'betrag (eur)', 'amount', 'betrag', 'importe', 'importe (eur)', 'umsatz', 'totale', 'valore',
  ],
  debit: ['dare', 'addebiti', 'addebito', 'uscite', 'uscita', 'importo in uscita', 'debit', 'debe', 'cargo', 'cargos', 'soll', 'ausgaben', 'paid out', 'money out', 'withdrawals', 'spese'],
  credit: ['avere', 'accrediti', 'accredito', 'entrate', 'entrata', 'importo in entrata', 'credit', 'haber', 'abono', 'abonos', 'haben', 'einnahmen', 'paid in', 'money in', 'deposits'],
  sign: ['segno', 'd/a', 'dare/avere', 'debit/credit', 'cr/dr', 'tipo importo', 'soll/haben', 's/h'],
  name: ['esercente', 'controparte', 'beneficiario', 'ordinante', 'merchant', 'partner name', 'partnername', 'payee', 'empfaenger', 'beguenstigter', 'zahlungsempfaenger', 'name', 'counterparty'],
  reference: [
    'descrizione operazione', 'descrizione movimento', 'descrizione', 'dettagli', 'dettaglio', 'causale', 'movimento', 'payment reference', 'verwendungszweck', 'reference', 'description', 'beschreibung',
    'concepto', 'detalle', 'buchungstext', 'note', 'memo', 'details',
  ],
  category: ['categoria', 'category', 'kategorie'],
  kind: ['tipo movimento', 'tipologia', 'tipo operazione', 'tipo di operazione', 'transaction type', 'type', 'typ', 'tipo'],
};

type Cols = { date: number; amount: number; debit: number; credit: number; sign: number; name: number; reference: number; category: number; kind: number };

function pick(headers: string[], names: string[], prefix?: RegExp): number {
  for (const n of names) {
    const i = headers.findIndex((h) => h === n);
    if (i > -1) return i;
  }
  return prefix ? headers.findIndex((h) => prefix.test(h)) : -1;
}

const clean = (h: unknown): string => norm(String(h ?? '')).replace(/[*:()]+/g, (m) => (m === '(' || m === ')' ? m : '')).replace(/\s+/g, ' ').trim();

const DEBIT_WORD = /^(d|dr|dare|debit|debito|addebito|uscita|s|soll|-|spesa|acquisto|pagamento|prelievo|cargo)\b/;
const CREDIT_WORD = /^(a|cr|avere|credit|credito|accredito|entrata|h|haben|\+|incasso|abono|ingreso)\b/;

/** Dirección que indica un texto de «tipo de operación» o de «signo». Sin indicio claro: `undefined`. */
export function hintFrom(text: string | undefined): 'debit' | 'credit' | undefined {
  const t = norm(text ?? '');
  if (!t) return undefined;
  if (DEBIT_WORD.test(t)) return 'debit';
  if (CREDIT_WORD.test(t)) return 'credit';
  return undefined;
}

export interface TableResult { rows: RawRow[]; warnings: string[]; /** Texto de cabecera y preámbulo, para reconocer el tipo de documento. */ docText: string }

/** Convierte una tabla (CSV, Excel, ODS) en movimientos. La cabecera puede no estar en la primera línea. */
export function rowsFromTable(table: string[][], context = ''): TableResult {
  const warnings: string[] = [];
  let hi = -1;
  let cols: Cols = { date: -1, amount: -1, debit: -1, credit: -1, sign: -1, name: -1, reference: -1, category: -1, kind: -1 };
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const hs = (table[i] ?? []).map(clean);
    const c: Cols = {
      date: pick(hs, H.date, /^(data|fecha|date|datum)\b/),
      amount: pick(hs, H.amount, /^(amount|betrag|importo|importe)\b/),
      debit: pick(hs, H.debit),
      credit: pick(hs, H.credit),
      sign: pick(hs, H.sign),
      name: pick(hs, H.name),
      reference: pick(hs, H.reference),
      category: pick(hs, H.category),
      kind: pick(hs, H.kind),
    };
    if (c.date > -1 && (c.amount > -1 || (c.debit > -1 && c.credit > -1) || c.debit > -1 || c.credit > -1)) { hi = i; cols = c; break; }
  }
  if (hi < 0) {
    const first = (table.find((r) => r.filter((x) => String(x ?? '').trim()).length >= 2) ?? table[0] ?? []).slice(0, 8).map((x) => String(x ?? '')).join(' | ');
    throw new Error(`No reconozco las columnas de fecha e importe. Cabecera encontrada: ${first}`);
  }

  const body = table.slice(hi + 1);
  const cell = (r: string[], i: number): string => (i > -1 ? String(r[i] ?? '').trim() : '');
  const dayFirst = detectDayFirst(body.map((r) => cell(r, cols.date)));
  const rows: RawRow[] = [];
  let bad = 0;
  for (const r of body) {
    const rawDate = cell(r, cols.date);
    if (!rawDate && !cell(r, cols.amount) && !cell(r, cols.debit) && !cell(r, cols.credit)) continue; // línea vacía o pie
    const date = parseDate(rawDate, dayFirst);
    let amountMinor: number | null = null;
    let hint: RawRow['hint'];
    if (cols.debit > -1 || cols.credit > -1) {
      // Columnas separadas de salidas y entradas: cada una va siempre en positivo.
      const d = parseAmount(cell(r, cols.debit));
      const c = parseAmount(cell(r, cols.credit));
      if (d !== null && c === null) amountMinor = -Math.abs(d);
      else if (c !== null && d === null) amountMinor = Math.abs(c);
      else if (d !== null && c !== null) amountMinor = Math.abs(c) - Math.abs(d) || null;
    }
    if (amountMinor === null && cols.amount > -1) {
      amountMinor = parseAmount(cell(r, cols.amount));
      const sg = hintFrom(cell(r, cols.sign));
      if (amountMinor !== null && sg) amountMinor = sg === 'debit' ? -Math.abs(amountMinor) : Math.abs(amountMinor);
      else if (amountMinor !== null) hint = hintFrom(cell(r, cols.kind));
    }
    if (!date || amountMinor === null) { bad++; continue; }
    rows.push({
      date,
      amountMinor,
      name: cell(r, cols.name) || undefined,
      reference: cell(r, cols.reference) || undefined,
      bankCategory: cell(r, cols.category) || undefined,
      kind: cell(r, cols.kind) || undefined,
      hint,
    });
  }
  if (bad > 0) warnings.push(`${bad} ${bad === 1 ? 'línea ignorada' : 'líneas ignoradas'} por no tener una fecha o un importe legibles.`);
  const docText = `${context} ${table.slice(0, hi + 1).map((r) => r.join(' ')).join(' ')}`.slice(0, 4000);
  return { rows, warnings, docText };
}

import { detectDayFirst, norm, parseAmount, parseDate } from './parse.js';
import type { RawRow } from './types.js';

/** Cabeceras conocidas (sin acentos, en minúsculas). El orden importa: primero lo más específico. */
const H = {
  date: [
    'data operazione', 'data movimento', 'data contabile', 'data transazione', 'data registrazione', 'data', 'data valuta',
    'booking date', 'buchungsdatum', 'buchungstag', 'buchung', 'belegdatum', 'fecha operacion', 'f operacion', 'f operativa', 'fecha contable', 'fecha',
    'date', 'transaction date', 'completed date', 'started date', 'datum', 'umsatzdatum', 'transaktionsdatum',
    'valutadatum', 'wertstellung', 'f valor', 'fecha valor', 'valuta', 'wert',
  ],
  amount: [
    'importo in eur', 'importo eur', 'importo in euro', 'importo (eur)', 'importo euro', 'importo', 'amount (eur)', 'betrag (eur)', 'betrag eur', 'betrag in eur', 'umsatz in eur',
    'amount', 'betrag', 'importe', 'importe (eur)', 'umsatz', 'totale', 'valore', 'gross', 'brutto', 'monto', 'cantidad', 'net',
  ],
  debit: ['dare', 'addebiti', 'addebito', 'uscite', 'uscita', 'importo in uscita', 'importo dare', 'debit', 'debe', 'cargo', 'cargos', 'soll', 'ausgaben', 'belastung', 'paid out', 'money out', 'withdrawals', 'spese'],
  credit: ['avere', 'accrediti', 'accredito', 'entrate', 'entrata', 'importo in entrata', 'importo avere', 'credit', 'haber', 'abono', 'abonos', 'haben', 'einnahmen', 'gutschrift', 'paid in', 'money in', 'deposits'],
  sign: ['segno', 'd/a', 'dare/avere', 'debit/credit', 'cr/dr', 'tipo importo', 'soll/haben', 's/h'],
  name: [
    'esercente', 'controparte', 'beneficiario', 'ordinante', 'merchant', 'partner name', 'partnername', 'payee', 'empfaenger', 'beguenstigter', 'zahlungsempfaenger',
    'beguenstigter/zahlungspflichtiger', 'beguenstigter/auftraggeber', 'auftraggeber/empfaenger', 'empfaenger/auftraggeber', 'name zahlungsbeteiligter', 'zahlungspflichtiger', 'zahlungsempfaengerin', 'zahlungspflichtigerin', 'auftraggeber',
    'name', 'counterparty', 'nome', 'denominazione', 'beneficiario/ordinante',
  ],
  reference: [
    'descrizione operazione', 'descrizione operazioni', 'descrizione movimento', 'descrizione completa', 'descrizione', 'dettagli', 'dettaglio', 'causale', 'operazione', 'movimento',
    'payment reference', 'verwendungszweck', 'reference', 'description', 'beschreibung', 'concepto', 'movimiento', 'descripcion', 'detalle', 'mas datos', 'observaciones', 'comentario',
    'buchungstext', 'vorgang', 'texto', 'note', 'memo', 'details', 'narrative', 'transaction details',
  ],
  category: ['categoria', 'category', 'kategorie'],
  kind: ['tipo movimento', 'tipologia', 'tipo operazione', 'tipo di operazione', 'transaction type', 'transaktionstyp', 'umsatzart', 'umsatztyp', 'type', 'typ', 'tipo'],
  status: ['stato', 'status', 'state', 'estado'],
};

/** Estados que indican que el movimiento no está (o ya no está) contabilizado: se omiten. */
const BAD_STATUS = /^(reverted|declined|failed|cancel+ed|rejected|void|annullat|stornat|storniert|abgelehnt|fehlgeschlagen|rifiutat|rechazad|cancelad|pending|vorgemerkt|in sospeso|in elaborazione|autorizzat|pendiente|ausstehend)/;

type Cols = { date: number; amount: number; debit: number; credit: number; sign: number; name: number; names: number[]; reference: number; category: number; kind: number; status: number };

function pick(headers: string[], names: string[], prefix?: RegExp): number {
  for (const n of names) {
    const i = headers.findIndex((h) => h === n);
    if (i > -1) return i;
  }
  return prefix ? headers.findIndex((h) => prefix.test(h)) : -1;
}

/** Cabecera comparable: sin acentos, ä→ae/ö→oe/ü→ue/ß→ss (como lo escriben los bancos alemanes sin tildes), sin signos de adorno. */
const clean = (h: unknown): string =>
  String(h ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/€/g, 'eur')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[*:#]+/g, '').replace(/[_.]+/g, ' ')
    .replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

const DEBIT_WORD = /^(d|dr|dare|debit|debito|addebito|uscita|s|soll|-|spesa|acquisto|pagamento|prelievo|cargo|ausgang|belastung|lastschrift|kartenzahlung|abbuchung)\b/;
const CREDIT_WORD = /^(a|cr|avere|credit|credito|accredito|entrata|h|haben|\+|incasso|abono|ingreso|eingang|gutschrift)\b/;

/** Dirección que indica un texto de «tipo de operación» o de «signo». Sin indicio claro: `undefined`. */
export function hintFrom(text: string | undefined): 'debit' | 'credit' | undefined {
  const t = norm(text ?? '');
  if (!t) return undefined;
  if (DEBIT_WORD.test(t)) return 'debit';
  if (CREDIT_WORD.test(t)) return 'credit';
  return undefined;
}

export interface TableResult { rows: RawRow[]; warnings: string[]; /** Texto de cabecera y preámbulo, para reconocer el tipo de documento. */ docText: string }

const AMOUNT_SHAPE = /^[+-]?\s*(?:eur\s*)?\d[\d.,' ]*[.,]\d{1,2}\s*(?:€|eur)?\s*-?$/i;
const BALANCE_HEADER = /(saldo|balance|kontostand|disponibile|disponible|running)/;

/** Todas las posiciones cuyo título coincide con alguno de los nombres, en orden de preferencia. */
function pickAll(headers: string[], names: string[]): number[] {
  const out: number[] = [];
  for (const n of names) headers.forEach((h, i) => { if (h === n && !out.includes(i)) out.push(i); });
  return out;
}

const cellOf = (r: string[], i: number): string => (i > -1 ? String(r[i] ?? '').trim() : '');

/** Proporción de celdas no vacías de la columna que cumplen `test`. */
function share(body: string[][], col: number, test: (v: string) => boolean): number {
  let n = 0;
  let ok = 0;
  for (const r of body) {
    const v = cellOf(r, col);
    if (!v) continue;
    n++;
    if (test(v)) ok++;
  }
  return n < 1 ? 0 : ok / n;
}

/**
 * Sin cabeceras reconocibles (o sin cabecera): deduce las columnas por lo que contienen.
 * La fecha es la columna cuyas celdas son casi todas fechas; el importe, la primera columna numérica con decimales
 * que no parezca un saldo; el texto, las columnas más largas.
 */
function inferColumns(table: string[][]): { cols: Cols; start: number; second: number } | null {
  const width = Math.min(80, Math.max(0, ...table.slice(0, 200).map((r) => r.length)));
  if (width < 2) return null;
  const sample = table.slice(0, 400);
  const dayFirst = detectDayFirst(sample.flatMap((r) => r.map((c) => String(c ?? '').trim())));
  const isDate = (v: string) => parseDate(v, dayFirst) !== null && /\d/.test(v) && v.length <= 24;
  const isAmount = (v: string) => AMOUNT_SHAPE.test(v) && parseAmount(v) !== null;
  // Primera fila de datos: la primera con una fecha y algún importe.
  const start = sample.findIndex((r) => r.some((c) => isDate(String(c ?? '').trim())) && r.some((c) => isAmount(String(c ?? '').trim())));
  if (start < 0) return null;
  const body = sample.slice(start);
  const dates = [...Array(width).keys()].map((i) => ({ i, f: share(body, i, isDate) })).filter((c) => c.f >= 0.6);
  if (!dates.length) return null;
  const date = dates[0]!.i;
  const hs = start > 0 ? (table[start - 1] ?? []).map(clean) : [];
  const nums = [...Array(width).keys()].filter((i) => i !== date && share(body, i, isAmount) >= 0.5 && !BALANCE_HEADER.test(hs[i] ?? ''));
  if (!nums.length) return null;
  const used = new Set([date, ...nums]);
  const texts = [...Array(width).keys()]
    .filter((i) => !used.has(i))
    .map((i) => {
      const vals = body.map((r) => cellOf(r, i)).filter(Boolean);
      const avg = vals.length ? vals.reduce((n, v) => n + v.length, 0) / vals.length : 0;
      const textual = vals.length ? vals.filter((v) => /[a-zA-ZÀ-ÿ]{3}/.test(v)).length / vals.length : 0;
      return { i, avg, ok: textual >= 0.6 && vals.length >= body.length * 0.3 && !isDate(vals[0] ?? '') };
    })
    .filter((c) => c.ok && c.avg >= 4)
    .sort((x, y) => y.avg - x.avg);
  const cols: Cols = { date, amount: nums[0]!, debit: -1, credit: -1, sign: -1, name: texts[1]?.i ?? -1, names: [], reference: texts[0]?.i ?? -1, category: -1, kind: -1, status: -1 };
  // Dos columnas numéricas que nunca coinciden en la misma fila: salidas y entradas por separado (se resuelve por el texto).
  let second = -1;
  if (nums.length >= 2) {
    const [x, y] = [nums[0]!, nums[1]!];
    const both = body.filter((r) => cellOf(r, x) && cellOf(r, y)).length;
    const filled = body.filter((r) => cellOf(r, x) || cellOf(r, y)).length;
    if (both === 0 && filled >= body.length * 0.8) second = y;
  }
  return { cols, start, second };
}

/** Convierte una tabla (CSV, Excel, ODS) en movimientos. La cabecera puede no estar en la primera línea. */
export function rowsFromTable(table: string[][], context = ''): TableResult {
  const warnings: string[] = [];
  let hi = -1;
  let cols: Cols = { date: -1, amount: -1, debit: -1, credit: -1, sign: -1, name: -1, names: [], reference: -1, category: -1, kind: -1, status: -1 };
  let secondAmount = -1;
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const hs = (table[i] ?? []).map(clean);
    const names = pickAll(hs, H.name);
    const c: Cols = {
      date: pick(hs, H.date, /^(data|fecha|date|datum)\b/),
      amount: pick(hs, H.amount, /^(amount|betrag|importo|importe)\b/),
      debit: pick(hs, H.debit),
      credit: pick(hs, H.credit),
      sign: pick(hs, H.sign),
      name: names[0] ?? -1,
      names,
      reference: pick(hs, H.reference),
      category: pick(hs, H.category),
      kind: pick(hs, H.kind),
      status: pick(hs, H.status),
    };
    if (c.date > -1 && (c.amount > -1 || (c.debit > -1 && c.credit > -1) || c.debit > -1 || c.credit > -1)) {
      hi = i; cols = c;
      // La columna de fecha elegida debe contener fechas de verdad («Valuta» puede ser la divisa).
      const rest = table.slice(i + 1);
      if (share(rest, cols.date, (v) => parseDate(v, true) !== null) < 0.5) {
        const alt = pickAll(hs, H.date).find((k) => share(rest, k, (v) => parseDate(v, true) !== null) >= 0.5);
        if (alt !== undefined) cols.date = alt;
      }
      break;
    }
  }
  if (hi < 0) {
    const inferred = inferColumns(table);
    if (!inferred) {
      const first = (table.find((r) => r.filter((x) => String(x ?? '').trim()).length >= 2) ?? table[0] ?? []).slice(0, 8).map((x) => String(x ?? '')).join(' | ');
      throw new Error(`No reconozco las columnas de fecha e importe. Cabecera encontrada: ${first}`);
    }
    hi = inferred.start - 1;
    cols = inferred.cols;
    secondAmount = inferred.second;
    warnings.push('No he reconocido las cabeceras de este extracto; he deducido las columnas por su contenido. Comprueba las fechas, los importes y qué es gasto y qué es ingreso.');
  }

  // Si hay varias columnas de nombre (pagador y receptor), el valor que se repite casi siempre es la propia persona:
  // en cada línea se usa el otro.
  const body = table.slice(hi + 1);
  const nameCols = cols.names.length ? cols.names : cols.name > -1 ? [cols.name] : [];
  const mine = new Set<string>();
  if (nameCols.length > 1) {
    for (const col of nameCols) {
      const counts = new Map<string, number>();
      let n = 0;
      for (const r of body) { const v = norm(cellOf(r, col)); if (!v) continue; n++; counts.set(v, (counts.get(v) ?? 0) + 1); }
      if (n < 4) continue;
      const [top, times] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]!;
      if (times / n >= 0.6) mine.add(top);
    }
  }
  const nameOf = (r: string[]): string => {
    const vals = nameCols.map((c) => cellOf(r, c)).filter(Boolean);
    return vals.find((v) => !mine.has(norm(v))) ?? vals[0] ?? '';
  };

  const dayFirst = detectDayFirst(body.map((r) => cellOf(r, cols.date)));
  const rows: RawRow[] = [];
  let bad = 0;
  let pending = 0;
  for (const r of body) {
    const rawDate = cellOf(r, cols.date);
    if (!rawDate && !cellOf(r, cols.amount) && !cellOf(r, cols.debit) && !cellOf(r, cols.credit) && !(secondAmount > -1 && cellOf(r, secondAmount))) continue; // línea vacía o pie
    const date = parseDate(rawDate, dayFirst);
    let amountMinor: number | null = null;
    let hint: RawRow['hint'];
    if (cols.debit > -1 || cols.credit > -1) {
      // Columnas separadas de salidas y entradas: cada una va siempre en positivo.
      const d = parseAmount(cellOf(r, cols.debit));
      const c = parseAmount(cellOf(r, cols.credit));
      if (d !== null && c === null) amountMinor = -Math.abs(d);
      else if (c !== null && d === null) amountMinor = Math.abs(c);
      else if (d !== null && c !== null) amountMinor = Math.abs(c) - Math.abs(d) || null;
    }
    if (amountMinor === null && cols.amount > -1) {
      amountMinor = parseAmount(cellOf(r, cols.amount));
      const sg = hintFrom(cellOf(r, cols.sign));
      if (amountMinor !== null && sg) amountMinor = sg === 'debit' ? -Math.abs(amountMinor) : Math.abs(amountMinor);
      else if (amountMinor !== null) hint = hintFrom(cellOf(r, cols.kind));
    }
    if (amountMinor === null && secondAmount > -1) amountMinor = parseAmount(cellOf(r, secondAmount));
    if (!date || amountMinor === null) { bad++; continue; }
    if (cols.status > -1 && BAD_STATUS.test(norm(cellOf(r, cols.status)))) { pending++; continue; }
    rows.push({
      date,
      amountMinor,
      name: nameOf(r) || undefined,
      reference: cellOf(r, cols.reference) || undefined,
      bankCategory: cellOf(r, cols.category) || undefined,
      kind: cellOf(r, cols.kind) || undefined,
      hint,
    });
  }
  if (bad > 0) warnings.push(`${bad} ${bad === 1 ? 'línea ignorada' : 'líneas ignoradas'} por no tener una fecha o un importe legibles.`);
  if (pending > 0) warnings.push(`${pending} ${pending === 1 ? 'movimiento omitido' : 'movimientos omitidos'} por estar pendientes, rechazados o anulados.`);
  const docText = `${context} ${table.slice(0, hi + 1).map((r) => r.join(' ')).join(' ')}`.slice(0, 4000);
  return { rows, warnings, docText };
}

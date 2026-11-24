import { detectDayFirst, norm, parseAmount, parseDate } from './parse.js';
import type { RawRow } from './types.js';

function detectDelimiter(head: string): string {
  let best = ',';
  let max = 0;
  for (const d of [';', ',', '\t', '|']) {
    let inQ = false;
    let n = 0;
    for (const ch of head) {
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) n++;
    }
    if (n > max) { max = n; best = d; }
  }
  return best;
}

/** CSV mínimo (RFC 4180): comillas, comillas escapadas y saltos de línea dentro de celdas. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const H = {
  date: ['booking date', 'buchungsdatum', 'buchungstag', 'fecha operacion', 'fecha', 'date', 'datum', 'valuta'],
  amount: ['amount (eur)', 'betrag (eur)', 'amount', 'betrag', 'importe', 'umsatz'],
  name: ['partner name', 'partnername', 'payee', 'empfaenger', 'beguenstigter', 'zahlungsempfaenger', 'name', 'beneficiario', 'counterparty'],
  reference: ['payment reference', 'verwendungszweck', 'reference', 'description', 'beschreibung', 'concepto', 'buchungstext'],
  category: ['category', 'kategorie', 'categoria'],
  kind: ['type', 'typ', 'tipo', 'transaction type'],
};

function pick(headers: string[], names: string[], prefix?: RegExp): number {
  for (const n of names) {
    const i = headers.findIndex((h) => h === n);
    if (i > -1) return i;
  }
  return prefix ? headers.findIndex((h) => prefix.test(h)) : -1;
}

export function rowsFromCsv(text: string): { rows: RawRow[]; warnings: string[] } {
  const table = parseCsv(text);
  const warnings: string[] = [];

  // La cabecera puede no ser la primera línea (algunos bancos meten un preámbulo).
  let hi = -1;
  let cols = { date: -1, amount: -1, name: -1, reference: -1, category: -1, kind: -1 };
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    const hs = table[i]!.map(norm);
    const c = { date: pick(hs, H.date), amount: pick(hs, H.amount, /^(amount|betrag|importe)\b/), name: pick(hs, H.name), reference: pick(hs, H.reference), category: pick(hs, H.category), kind: pick(hs, H.kind) };
    if (c.date > -1 && c.amount > -1) { hi = i; cols = c; break; }
  }
  if (hi < 0) {
    throw new Error(`No reconozco las columnas de fecha e importe. Cabecera encontrada: ${(table[0] ?? []).slice(0, 8).join(' | ')}`);
  }

  const body = table.slice(hi + 1);
  const dayFirst = detectDayFirst(body.map((r) => (r[cols.date] ?? '').trim()));
  const rows: RawRow[] = [];
  let bad = 0;
  for (const r of body) {
    const date = parseDate(r[cols.date] ?? '', dayFirst);
    const amountMinor = parseAmount(r[cols.amount] ?? '');
    if (!date || amountMinor === null) { bad++; continue; }
    rows.push({
      date,
      amountMinor,
      name: cols.name > -1 ? (r[cols.name] ?? '').trim() : undefined,
      reference: cols.reference > -1 ? (r[cols.reference] ?? '').trim() : undefined,
      bankCategory: cols.category > -1 ? (r[cols.category] ?? '').trim() : undefined,
      kind: cols.kind > -1 ? (r[cols.kind] ?? '').trim() : undefined,
    });
  }
  if (bad > 0) warnings.push(`${bad} ${bad === 1 ? 'línea ignorada' : 'líneas ignoradas'} por no tener una fecha o un importe legibles.`);
  return { rows, warnings };
}

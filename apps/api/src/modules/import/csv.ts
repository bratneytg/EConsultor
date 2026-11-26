import { rowsFromTable, type TableResult } from './table.js';

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

export function rowsFromCsv(text: string): TableResult {
  return rowsFromTable(parseCsv(text));
}

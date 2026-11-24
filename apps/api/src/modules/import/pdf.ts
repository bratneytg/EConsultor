import { getDocumentProxy } from 'unpdf';
import { detectDayFirst, parseAmount, parseDate } from './parse.js';
import type { RawRow } from './types.js';

/**
 * Texto del PDF por líneas, reconstruidas con las coordenadas de cada fragmento (las tablas de los
 * extractos se parten en celdas sueltas). Funciona sin conexión; un PDF escaneado (imagen) no tiene texto.
 */
export async function pdfLines(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[]; width?: number }[])
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '' && it.transform)
      .map((it) => ({ s: it.str!, x: it.transform![4]!, y: it.transform![5]!, w: it.width ?? 0 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: typeof items = [];
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      let out = '';
      let end = -Infinity;
      for (const it of cur) {
        out += (out && it.x - end > 1.5 ? ' ' : '') + it.s;
        end = it.x + it.w;
      }
      lines.push(out.replace(/\s+/g, ' ').trim());
      cur = [];
    };
    let y = Infinity;
    for (const it of items) {
      if (Math.abs(it.y - y) > 2.5) { flush(); y = it.y; }
      cur.push(it);
    }
    flush();
  }
  return lines;
}

const DATE = /(?<![\d.,])(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?|\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))(?![\d,])/;
const AMOUNT = /([+\-−–]?\(?\d[\d.,]*[.,]\d{2}\)?)\s*(?:€|EUR)?\s*(S|H|CR|DR)?(?=\s|$)/gi;
const NOISE = /saldo|kontostand|balance|anfangs|endsaldo|summe|gesamt|total|übertrag|uebertrag|vortrag|seite|page|iban|bic|zinsen? bis|kontoauszug/i;

/** Líneas con fecha + importe → movimientos. Heurístico: cubre extractos tabulares con una línea por movimiento. */
export function rowsFromPdfLines(lines: string[], fallbackYear = new Date().getFullYear()): { rows: RawRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const year = lines.join(' ').match(/\b(20\d{2})\b/)?.[1];
  const yr = year ? Number(year) : fallbackYear;
  const dayFirst = detectDayFirst(lines.flatMap((l) => l.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g) ?? []));
  const rows: RawRow[] = [];
  let twoAmounts = 0;

  for (const line of lines) {
    if (NOISE.test(line)) continue;
    const d = line.match(DATE);
    if (!d) continue;
    const date = parseDate(d[1]!, dayFirst, yr);
    if (!date) continue;
    const rest = line.replace(d[0], ' ');
    const amts = [...rest.matchAll(AMOUNT)];
    if (!amts.length) continue;
    // Con dos importes en la línea suelen ser «importe» y «saldo»: se toma el penúltimo.
    const tail = amts.length >= 2 ? amts[amts.length - 2]! : amts[0]!;
    if (amts.length >= 2) twoAmounts++;
    const raw = tail[1]! + (tail[2] ?? '');
    const amountMinor = parseAmount(raw);
    if (amountMinor === null) continue;
    const name = rest.slice(0, tail.index).replace(/\s+/g, ' ').replace(/[|·]+/g, ' ').trim();
    rows.push({ date, amountMinor, name: name.slice(0, 120) });
  }
  if (twoAmounts > rows.length / 2 && rows.length) warnings.push('El PDF parece tener una columna de saldo; he usado la primera cifra de cada línea como importe. Revisa los signos.');
  if (rows.some((r) => r.amountMinor > 0) && !rows.some((r) => r.amountMinor < 0)) {
    warnings.push('No he podido distinguir gastos de ingresos por el signo: revisa la categoría de cada línea (elige una de ingresos si lo es).');
  }
  return { rows, warnings };
}

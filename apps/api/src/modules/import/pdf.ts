import { getDocumentProxy } from 'unpdf';
import { detectDayFirst, parseAmount, parseDate } from './parse.js';
import type { RawRow } from './types.js';
import { tr } from '../../lib/i18n.js';

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

const MONTH = '(?:gen|ene|jan|feb|fev|mar|apr|abr|avr|mag|may|mai|giu|jun|lug|jul|ago|aug|set|sep|ott|oct|okt|nov|dic|dec|dez)[a-z]*';
const DATE_G = new RegExp(
  `(?<![\\d.,/])(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./](?:\\d{4}|\\d{2})(?!\\d)|\\d{1,2}\\.\\d{1,2}\\.|\\d{1,2}\\.?\\s+${MONTH}\\.?,?\\s+(?:\\d{4}|\\d{2})(?!\\d))(?![\\d,])`,
  'gi',
);
const AMOUNT = /([+\-−–]?\(?\d[\d.,]*[.,]\d{2}\)?)\s*(?:€|EUR)?\s*(S|H|CR|DR|[+\-−–])?(?=\s|$)/gi;
const NOISE = /saldo|kontostand|balance|anfangs|endsaldo|summe|gesamt|total|übertrag|uebertrag|vortrag|seite|page|pagina|iban|bic|zinsen? bis|kontoauszug|estratto conto|limite|plafond|scadenza|codice|periodo|interessi|importo dovuto|data (di )?(stampa|emissione)/i;
// Moneda extranjera junto al primer importe: «AMAZON US 25,00 USD 23,10»: el importe en euros es el último.
const FOREIGN = /\b(USD|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|BGN|HRK|CNY|HKD|AED|MXN|BRL)\b|[$£]/;

/** Líneas con fecha + importe → movimientos. Heurístico: cubre extractos tabulares con una línea por movimiento. */
export function rowsFromPdfLines(lines: string[], fallbackYear = new Date().getFullYear()): { rows: RawRow[]; warnings: string[]; docText: string } {
  const warnings: string[] = [];
  const year = lines.join(' ').match(/\b(20\d{2})\b/)?.[1];
  const yr = year ? Number(year) : fallbackYear;
  const dayFirst = detectDayFirst(lines.flatMap((l) => l.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g) ?? []));
  const rows: RawRow[] = [];
  let twoAmounts = 0;

  for (const line of lines) {
    if (NOISE.test(line)) continue;
    const dates = [...line.matchAll(DATE_G)];
    if (!dates.length) continue;
    // La primera fecha es la de la operación; la segunda (registro/valor), si existe, se descarta.
    const date = parseDate(dates[0]![1]!, dayFirst, yr);
    if (!date) continue;
    let rest = line;
    for (const d of dates) rest = rest.replace(d[0], ' ');
    const amts = [...rest.matchAll(AMOUNT)];
    if (!amts.length) continue;
    // Con dos importes en la línea suelen ser «importe» y «saldo»: se toma el penúltimo. Con moneda extranjera,
    // «importe original» y «importe en euros»: se toma el último.
    let pickIdx = amts.length >= 2 ? amts.length - 2 : 0;
    let foreign = false;
    if (amts.length >= 2) {
      twoAmounts++;
      const between = rest.slice(amts[0]!.index!, amts[amts.length - 1]!.index! + amts[amts.length - 1]![0].length);
      if (FOREIGN.test(between) || FOREIGN.test(rest.slice(0, amts[0]!.index!).slice(-6))) { pickIdx = amts.length - 1; twoAmounts--; foreign = true; }
    }
    const tail = amts[pickIdx]!;
    const amountMinor = parseAmount(tail[1]! + (tail[2] ?? ''));
    if (amountMinor === null) continue;
    const body = rest.slice(0, foreign ? amts[0]!.index : tail.index).replace(/\s+/g, ' ').replace(/[|·]+/g, ' ').trim().replace(/\s*\b[A-Z]{3}$/, foreign ? '' : '$&');
    rows.push({ date, amountMinor, name: body.slice(0, 120) });
  }
  if (twoAmounts > rows.length / 2 && rows.length) warnings.push(tr('El PDF parece tener una columna de saldo; he usado la primera cifra de cada línea como importe. Revisa los signos.'));
  return { rows, warnings, docText: lines.slice(0, 60).join(' ') };
}

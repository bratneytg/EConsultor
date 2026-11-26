/** Utilidades de lectura de fechas e importes de extractos europeos (y algún formato anglosajón). */

const pad = (n: number): string => String(n).padStart(2, '0');

/** ¿Los extractos con `/` o `.` vienen día-primero? Se decide mirando el archivo entero (por defecto sí, es lo europeo). */
export function detectDayFirst(samples: string[]): boolean {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const s of samples) {
    const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  return !(secondOver12 && !firstOver12);
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Meses en italiano, español, alemán, inglés y francés (3 primeras letras, sin acentos). */
const MONTHS: Record<string, number> = {
  gen: 1, ene: 1, jan: 1, janv: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, avr: 4, mag: 5, may: 5, mai: 5, giu: 6, jun: 6, juin: 6,
  lug: 7, jul: 7, juil: 7, ago: 8, aug: 8, aou: 8, set: 9, sep: 9, ott: 10, oct: 10, okt: 10, nov: 11, dic: 12, dec: 12, dez: 12,
};
/** `5 nov 2026`, `05 novembre 2026`, `5. Nov. 2026`, `Nov 5, 2026`. */
export const MONTH_DATE = /(\d{1,2})\.?\s+([a-zA-Zéûô]{3,10})\.?,?\s+(\d{4}|\d{2})\b/;

/** `YYYY-MM-DD[ T…]`, `DD.MM.YYYY`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YY`. */
export function parseDate(input: string, dayFirst = true, fallbackYear?: number): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return dayFirst ? valid(y, b, a) : valid(y, a, b);
  }
  m = s.match(/^(\d{1,2})[./](\d{1,2})\.?$/); // «03.11.» o «03/11» sin año (PDF)
  if (m && fallbackYear) return valid(fallbackYear, Number(m[2]), Number(m[1]));
  m = s.match(new RegExp(`^${MONTH_DATE.source}`));
  if (m) {
    const mon = MONTHS[norm(m[2]!).slice(0, 4)] ?? MONTHS[norm(m[2]!).slice(0, 3)];
    if (mon) return valid(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), mon, Number(m[1]));
  }
  return null;
}

/**
 * Importe con signo en unidades menores. Admite `1.234,56`, `1,234.56`, `-12,5`, `(12.34)`, `12,34-`,
 * símbolos de moneda y los marcadores S/H (debe/haber) y CR/DR.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/[€$£\s\u00a0\u202f]|EUR|USD|GBP|CHF/gi, '').replace(/[−–—]/g, '-');
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  const tail = s.match(/(S|DR|H|CR)$/i);
  if (tail) { if (/^(S|DR)$/i.test(tail[1]!)) sign = -1; s = s.slice(0, -tail[1]!.length); }
  if (s.endsWith('-')) { sign = -1; s = s.slice(0, -1); } else if (s.endsWith('+')) s = s.slice(0, -1);
  if (s.startsWith('-')) { sign = -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma > -1) s = s.replace(/,/g, (_, i: number) => (i === lastComma ? '.' : ''));
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const minor = Math.round(Number(s) * 100);
  return minor === 0 || minor > 100_000_000_00 ? null : sign * minor;
}

export const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').trim();

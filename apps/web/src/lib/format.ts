const nfCache = new Map<string, Intl.NumberFormat>();
function nf(currency: string, digits: number): Intl.NumberFormat {
  const key = `${currency}|${digits}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    nfCache.set(key, f);
  }
  return f;
}

/** 123456 → "1.234,56 €" */
export const money = (minor: number, currency: string, digits = 2): string => nf(currency, digits).format(minor / 100);

/** Sin decimales cuando el importe es redondo; compacto para ejes. */
export const moneyShort = (minor: number, currency: string): string => {
  const v = minor / 100;
  const abs = Math.abs(v);
  if (abs >= 10_000) return `${new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} ${symbol(currency)}`;
  return nf(currency, abs % 1 === 0 || abs >= 1000 ? 0 : 2).format(v);
};

export function symbol(currency: string): string {
  return nf(currency, 0).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

/** Partes para el número "héroe": entero grande y decimales pequeños. */
export function moneyParts(minor: number, currency: string): { sign: string; int: string; dec: string; cur: string } {
  const parts = nf(currency, 2).formatToParts(minor / 100);
  const pick = (t: string) => parts.filter((p) => p.type === t).map((p) => p.value).join('');
  const int = parts.filter((p) => p.type === 'integer' || p.type === 'group').map((p) => p.value).join('');
  return { sign: pick('minusSign'), int, dec: pick('decimal') + pick('fraction'), cur: pick('currency') };
}

/** Importe tecleado ("12,5", "1.234,56", "12.50") → céntimos, o null si no es válido. */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/\s/g, '').replace(/[€$£]/g, '');
  if (!s) return null;
  // "1.234,56" → 1234.56 ; "1,234.56" → 1234.56 ; "12,5" → 12.5
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const minor = Math.round(Number(s) * 100);
  return minor > 0 && minor <= 10_000_000_000 ? minor : null;
}

export const pct = (v: number, digits = 0): string => `${(v * 100).toFixed(digits).replace('.', ',')} %`;

const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const MONTH_SHORT = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
const DAY_LONG = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_SHORT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const d = (s: string): Date => new Date(`${s.length === 7 ? `${s}-01` : s}T00:00:00Z`);
export const monthLabel = (m: string): string => MONTH.format(d(m));
export const monthShort = (m: string): string => MONTH_SHORT.format(d(m)).replace('.', '');
export const dayLong = (s: string): string => DAY_LONG.format(d(s));
export const dayShort = (s: string): string => DAY_SHORT.format(d(s));

export const shiftMonth = (m: string, delta: number): string => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
};

export const isoToday = (tz?: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const addDays = (s: string, n: number): string => {
  const x = d(s);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export function relativeDay(date: string, today: string): string {
  if (date === today) return 'Hoy';
  if (date === addDays(today, -1)) return 'Ayer';
  return dayLong(date);
}

export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];

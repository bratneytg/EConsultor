/** Utilidades de fechas "de calendario" (YYYY-MM-DD) calculadas en UTC para evitar saltos por zona horaria. */

const parse = (s: string): Date => new Date(`${s}T00:00:00Z`);
export const fmt = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (s: string, n: number): string => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

export const diffDays = (a: string, b: string): number => Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);

export const monthOf = (date: string): string => date.slice(0, 7);

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export const lastMonths = (month: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => shiftMonth(month, -(n - 1 - i)));

/** 0 = lunes … 6 = domingo */
export const weekdayMon0 = (date: string): number => (parse(date).getUTCDay() + 6) % 7;

/** Fecha de hoy en la zona horaria dada. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    return parts; // en-CA => YYYY-MM-DD
  } catch {
    return fmt(now);
  }
}

/** Hora local HH:MM en la zona dada. */
export function timeIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

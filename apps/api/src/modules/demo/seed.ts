import { randomUUID } from 'node:crypto';
import type { Transaction } from '@econsultor/shared';
import { addDays, daysInMonth, lastMonths, monthOf, weekdayMon0 } from '../../lib/dates.js';

/** PRNG determinista (mulberry32) para que la demo sea reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Genera ~6 meses de movimientos realistas (importes en la unidad menor de la moneda). */
export function generateDemoTransactions(today: string, seed = 42): Transaction[] {
  const rand = rng(seed);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const out: Transaction[] = [];
  const nowIso = new Date().toISOString();

  const add = (date: string, type: 'income' | 'expense', categoryId: string, amountMinor: number, note?: string) => {
    if (date > today || amountMinor <= 0) return;
    out.push({ id: randomUUID(), type, categoryId, amountMinor, currency: 'EUR', date, note, createdAt: nowIso, updatedAt: nowIso });
  };

  for (const month of lastMonths(monthOf(today), 6)) {
    const dim = daysInMonth(month);
    const d = (day: number) => `${month}-${String(Math.min(day, dim)).padStart(2, '0')}`;

    add(d(1), 'income', 'salary', between(2380, 2480), 'Nómina');
    add(d(3), 'expense', 'housing', 78000, 'Alquiler');
    add(d(5), 'expense', 'utilities', between(55, 78), 'Electricidad');
    add(d(6), 'expense', 'utilities', 2999, 'Internet');
    add(d(6), 'expense', 'utilities', 1499, 'Móvil');
    add(d(8), 'expense', 'subscriptions', 1399, 'Streaming');
    add(d(8), 'expense', 'subscriptions', 1099, 'Música');
    add(d(15), 'expense', 'subscriptions', 2490, 'Gimnasio');
    add(d(12), 'expense', 'insurance', 3800, 'Seguro');
    add(d(2), 'expense', 'transport', 5800, 'Abono transporte');

    if (rand() < 0.5) add(d(10 + Math.floor(rand() * 15)), 'income', 'freelance', between(120, 380), 'Trabajo extra');
    if (rand() < 0.15) add(d(20), 'income', 'gifts', between(30, 80));
    if (rand() < 0.25) add(d(4 + Math.floor(rand() * 20)), 'expense', 'health', between(12, 40), 'Farmacia');
    if (rand() < 0.2) add(d(10 + Math.floor(rand() * 12)), 'expense', 'travel', between(80, 300), 'Escapada');

    for (let day = 1; day <= dim; day++) {
      const date = d(day);
      const wd = weekdayMon0(date);
      const weekend = wd >= 5;
      if (rand() < 0.5) add(date, 'expense', 'groceries', between(16, 84), pick(['Supermercado', 'Mercado', 'Panadería']));
      if (rand() < (weekend ? 0.8 : 0.4)) add(date, 'expense', 'dining', between(8, weekend ? 64 : 28), pick(['Comida fuera', 'Café', 'Cena', 'Takeaway']));
      if (rand() < (weekend ? 0.4 : 0.1)) add(date, 'expense', 'leisure', between(10, 58), pick(['Cine', 'Bar', 'Concierto', 'Videojuego']));
      if (rand() < 0.1) add(date, 'expense', 'shopping', between(18, 160), pick(['Ropa', 'Hogar', 'Electrónica']));
      if (rand() < 0.1) add(date, 'expense', 'transport', between(6, 44), pick(['Taxi', 'Gasolina', 'Tren']));
    }
  }

  // Racha visible: al menos un movimiento en cada uno de los 9 días previos a hoy.
  const logged = new Set(out.map((t) => t.date));
  for (let i = 1; i <= 9; i++) {
    const date = addDays(today, -i);
    if (!logged.has(date)) add(date, 'expense', 'groceries', between(6, 28), 'Compra rápida');
  }
  return out;
}

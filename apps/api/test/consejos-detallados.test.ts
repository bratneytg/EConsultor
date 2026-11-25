import type { Transaction } from '@econsultor/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { getDetailedAdvice } from '../src/modules/advice/advisor.js';
import { detailedDigest } from '../src/modules/advice/claude.js';
import { buildSpendingDetail, detailedAdvice, merchantKey } from '../src/modules/advice/detailed.js';
import { addDays } from '../src/lib/dates.js';

const TODAY = '2026-11-25';
let n = 0;
const tx = (daysAgo: number, amountMinor: number, categoryId: string, note?: string, type: 'expense' | 'income' = 'expense'): Transaction => ({
  id: `t${++n}`, type, amountMinor, currency: 'EUR', categoryId, date: addDays(TODAY, -daysAgo), note, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

/** Tres meses de una vida creíble: súper cada 3 días, café casi a diario, suscripciones, alquiler, ocio los findes. */
function vida(): Transaction[] {
  const out: Transaction[] = [];
  for (let d = 0; d < 90; d += 3) out.push(tx(d, 1800 + (d % 7) * 200, 'groceries', 'REWE SAGT DANKE 4711 · Berlin'));
  for (let d = 1; d < 90; d += 6) out.push(tx(d, 2600, 'groceries', 'LIDL DIENSTLEISTUNG'));
  for (let d = 0; d < 90; d += 2) out.push(tx(d, 380, 'dining', 'Starbucks Berlin Mitte'));
  for (let m = 0; m < 3; m++) {
    out.push(tx(5 + m * 30, 1299, 'subscriptions', 'NETFLIX.COM'));
    out.push(tx(7 + m * 30, 999, 'subscriptions', 'Spotify AB'));
    out.push(tx(9 + m * 30, 2490, 'subscriptions', 'McFit GmbH'));
    out.push(tx(3 + m * 30, 85000, 'housing', 'Miete Hausverwaltung Mueller'));
  }
  for (let d = 0; d < 90; d += 7) out.push(tx(d + ((4 - ((new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7) + 7) % 7) % 7, 3800, 'leisure', 'Kino Cinemaxx'));
  for (let d = 2; d < 90; d += 9) out.push(tx(d, 3400, 'other_expense', 'Zahlung an M. Schmidt'));
  out.push(tx(10, 99900, 'shopping', 'MediaMarkt Berlin'));
  for (let m = 0; m < 3; m++) out.push(tx(m * 30 + 1, 280000, 'salary', 'Gehalt DHL', 'income'));
  return out;
}

describe('claves de comercio', () => {
  it('agrupa variantes del mismo comercio y descarta ruido de pago', () => {
    expect(merchantKey('REWE SAGT DANKE 4711 · Berlin')?.key).toBe('rewe');
    expect(merchantKey('Kartenzahlung REWE Markt GmbH')?.key).toBe('rewe');
    expect(merchantKey('NETFLIX.COM')?.key).toBe('netflix');
    expect(merchantKey('1234 5678')).toBeNull();
    expect(merchantKey(undefined)).toBeNull();
  });
});

describe('análisis detallado de gastos', () => {
  const d = buildSpendingDetail(vida(), TODAY, 'EUR');
  const items = detailedAdvice(d);

  it('detecta los cargos recurrentes por comercio', () => {
    const labels = d.recurring.map((r) => r.label.toLowerCase());
    expect(labels).toEqual(expect.arrayContaining(['netflix', 'spotify', 'mcfit']));
    expect(d.recurring.find((r) => /netflix/i.test(r.label))!.monthlyMinor).toBe(1299);
  });

  it('detecta el gasto pequeño repetido (el café) y lo cuantifica', () => {
    const cafe = d.smallFrequent.find((s) => /starbucks/i.test(s.label));
    expect(cafe).toBeTruthy();
    expect(cafe!.count).toBe(45);
    const small = items.find((i) => i.id === 'd-small')!;
    expect(small.body).toMatch(/Starbucks/);
    expect(small.action).toMatch(/semana sin Starbucks/);
    expect(small.impactMinor!).toBeGreaterThan(0);
  });

  it('da un consejo del súper con visitas, ticket medio y tope semanal', () => {
    const s = items.find((i) => i.id === 'd-cat-groceries')!;
    expect(s).toBeTruthy();
    expect(s.body).toMatch(/pagos al mes/);
    expect(s.body).toMatch(/REWE|Rewe/);
    expect(s.action).toMatch(/tope semanal/);
  });

  it('todos los consejos traen una acción concreta', () => {
    for (const i of items) expect(i.action && i.action.length > 15, i.id).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.length).toBeLessThanOrEqual(9);
  });

  it('avisa de lo que queda sin clasificar', () => {
    expect(items.some((i) => i.id === 'd-unclassified')).toBe(true);
  });

  it('con pocos movimientos pide más datos en vez de inventar', () => {
    const few = detailedAdvice(buildSpendingDetail(vida().slice(0, 5), TODAY, 'EUR'));
    expect(few).toHaveLength(1);
    expect(few[0]!.id).toBe('d-need-data');
  });

  it('el resumen para la IA no contiene fechas, notas completas ni IBAN', () => {
    const txs = [...vida(), tx(4, 5000, 'other_expense', 'Zahlung DE89370400440532013000 an max@example.com Ref 123456789012')];
    const text = JSON.stringify(detailedDigest(buildSpendingDetail(txs, TODAY, 'EUR')));
    expect(text).not.toMatch(/DE89370400440532013000/);
    expect(text).not.toMatch(/max@example\.com/);
    expect(text).not.toMatch(/123456789012/);
    expect(text).not.toMatch(/2026-1\d-\d\d/);
  });
});

describe('getDetailedAdvice', () => {
  const cfg = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const base = { userId: 'u1', currency: 'EUR', today: TODAY, txs: vida() };

  it('premium ve todo y sin clave de IA usa el análisis local aunque pida IA', async () => {
    const r = await getDetailedAdvice(cfg, { ...base, plan: 'premium', useAi: true });
    expect(r.source).toBe('rules');
    expect(r.lockedCount).toBe(0);
    expect(r.basis?.aiAvailable).toBe(false);
    expect(r.items.length).toBeGreaterThan(4);
  });

  it('gratis ve 2 consejos y el resto bloqueado', async () => {
    const r = await getDetailedAdvice(cfg, { ...base, userId: 'u2', plan: 'free' });
    expect(r.items).toHaveLength(2);
    expect(r.lockedCount).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { Transaction } from '@econsultor/shared';
import { buildOverview, streakDays } from '../src/modules/analytics/analytics.js';
import { runReminders } from '../src/modules/notifications/scheduler.js';
import { buildFinancialProfile } from '../src/modules/profile/engine.js';
import { ruleBasedAdvice } from '../src/modules/advice/rules.js';
import { FileStore } from '../src/store/file-store.js';

let i = 0;
const tx = (date: string, type: 'income' | 'expense', categoryId: string, amountMinor: number): Transaction => ({
  id: `t${++i}`, type, categoryId, amountMinor, currency: 'EUR', date, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

const TODAY = '2026-11-20';

describe('buildOverview', () => {
  const txs = [
    tx('2026-11-01', 'income', 'salary', 200000),
    tx('2026-11-03', 'expense', 'housing', 80000),
    tx('2026-11-05', 'expense', 'groceries', 5000),
    tx('2026-11-10', 'expense', 'dining', 3000),
    tx('2026-10-01', 'income', 'salary', 200000),
    tx('2026-10-03', 'expense', 'housing', 80000),
    tx('2026-10-15', 'expense', 'groceries', 4000),
  ];
  const o = buildOverview(txs, { month: '2026-11', today: TODAY, currency: 'EUR' });

  it('totales y ahorro', () => {
    expect(o.totals).toMatchObject({ incomeMinor: 200000, expenseMinor: 88000, netMinor: 112000 });
    expect(o.totals.savingsRate).toBeCloseTo(0.56, 5);
    expect(o.prevTotals).toEqual({ incomeMinor: 200000, expenseMinor: 84000 });
  });

  it('saldo diario acumulado termina en el neto', () => {
    expect(o.daily).toHaveLength(20);
    expect(o.daily.at(-1)!.balanceMinor).toBe(o.totals.netMinor);
  });

  it('compara categorías con el mes anterior', () => {
    const g = o.expenseByCategory.find((c) => c.categoryId === 'groceries')!;
    expect(g.prevAmountMinor).toBe(4000);
  });

  it('la previsión conserva los fijos esperados y arranca desde el saldo de hoy', () => {
    expect(o.forecast.daysElapsed).toBe(20);
    expect(o.forecast.projectedBalance[0]!.balanceMinor).toBe(o.daily.at(-1)!.balanceMinor);
    expect(o.forecast.projectedBalance.at(-1)!.date).toBe('2026-11-30');
    expect(o.forecast.projectedExpenseMinor).toBeGreaterThan(o.totals.expenseMinor);
  });

  it('un mes pasado no tiene previsión', () => {
    const past = buildOverview(txs, { month: '2026-10', today: TODAY, currency: 'EUR' });
    expect(past.forecast.projectedBalance).toHaveLength(0);
    expect(past.forecast.projectedExpenseMinor).toBe(past.totals.expenseMinor);
    expect(past.daily).toHaveLength(31);
  });

  it('sin datos no revienta', () => {
    const empty = buildOverview([], { month: '2026-11', today: TODAY, currency: 'EUR' });
    expect(empty.totals.savingsRate).toBe(0);
    expect(empty.health.score).toBeGreaterThanOrEqual(0);
    expect(empty.expenseByCategory).toEqual([]);
  });
});

describe('racha', () => {
  it('cuenta días consecutivos aunque hoy aún no haya registro', () => {
    const txs = ['2026-11-19', '2026-11-18', '2026-11-17', '2026-11-15'].map((d) => tx(d, 'expense', 'groceries', 100));
    expect(streakDays(txs, TODAY)).toBe(3);
    expect(streakDays([...txs, tx(TODAY, 'expense', 'groceries', 100)], TODAY)).toBe(4);
  });
});

describe('perfil financiero y reglas', () => {
  it('detecta un perfil deficitario y lo aconseja', () => {
    const txs: Transaction[] = [];
    for (const m of ['2026-08', '2026-09', '2026-10']) {
      txs.push(tx(`${m}-01`, 'income', 'salary', 150000), tx(`${m}-02`, 'expense', 'housing', 90000), tx(`${m}-10`, 'expense', 'leisure', 80000));
    }
    const p = buildFinancialProfile(txs, TODAY);
    expect(p.archetype).toBe('overspender');
    expect(p.savingsRate).toBeLessThan(0);
    const advice = ruleBasedAdvice(p, buildOverview(txs, { month: '2026-11', today: TODAY, currency: 'EUR' }));
    expect(advice.some((a) => a.id === 'deficit' && a.severity === 'warn')).toBe(true);
  });

  it('sin datos pide empezar a registrar', () => {
    const p = buildFinancialProfile([], TODAY);
    const advice = ruleBasedAdvice(p, buildOverview([], { month: '2026-11', today: TODAY, currency: 'EUR' }));
    expect(advice[0]!.id).toBe('start-logging');
  });
});

describe('recordatorio diario', () => {
  async function setup(logToday: boolean) {
    const store = new FileStore({ file: null });
    await store.users.create({
      id: 'u1', email: 'a@b.com', displayName: 'Ana García', plan: 'free', currency: 'EUR', timezone: 'Europe/Berlin',
      reminderEnabled: true, reminderTime: '21:00', mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: '', updatedAt: '',
    });
    await store.push.upsert({ endpoint: 'https://push.example/1', userId: 'u1', keys: { p256dh: 'x', auth: 'y' }, createdAt: '' });
    if (logToday) await store.transactions.create('u1', tx('2026-11-20', 'expense', 'groceries', 500));
    return store;
  }
  const sent: string[] = [];
  const send = async (_s: unknown, payload: string) => void sent.push(payload);

  it('avisa a la hora local del usuario, una sola vez al día', async () => {
    sent.length = 0;
    const store = await setup(false);
    // 19:30 UTC = 20:30 en Berlín (noviembre, UTC+1): aún no
    expect(await runReminders(store, new Date('2026-11-20T19:30:00Z'), send)).toBe(0);
    // 20:05 UTC = 21:05 Berlín: toca
    expect(await runReminders(store, new Date('2026-11-20T20:05:00Z'), send)).toBe(1);
    expect(JSON.parse(sent[0]!).body).toContain('Ana');
    // no repite
    expect(await runReminders(store, new Date('2026-11-20T20:10:00Z'), send)).toBe(0);
  });

  it('no molesta si ya registró algo hoy', async () => {
    sent.length = 0;
    const store = await setup(true);
    expect(await runReminders(store, new Date('2026-11-20T20:05:00Z'), send)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

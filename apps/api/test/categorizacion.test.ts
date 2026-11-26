import { describe, expect, it } from 'vitest';
import { buildHistory, categorize } from '../src/modules/import/categorize.js';
import { CASOS } from './fixtures/comercios.js';

const row = (name: string, amountMinor = -1500, reference = '') => ({ date: '2026-11-01', amountMinor, name, reference });

describe('categorización al importar', () => {
  it('clasifica casi todo lo que se puede saber, acierta y no inventa lo que no se puede saber', () => {
    let conocidos = 0, clasificados = 0, acertados = 0, inventados = 0;
    const fallos: string[] = [];
    for (const [name, reference, amountMinor, expected] of CASOS) {
      const c = categorize(row(name, amountMinor, reference));
      const sabe = c.via !== 'default';
      if (expected === '?') {
        if (sabe) { inventados++; fallos.push(`inventa: ${name} → ${c.categoryId}`); }
        continue;
      }
      conocidos++;
      if (sabe) clasificados++;
      if (c.categoryId === expected) acertados++;
      else fallos.push(`${name} → ${c.categoryId} (esperada ${expected})`);
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(clasificados / conocidos).toBeGreaterThanOrEqual(0.95);
    expect(acertados / conocidos).toBeGreaterThanOrEqual(0.95);
    expect(inventados).toBe(0);
  });

  it('no confunde comercios cuyo nombre contiene otra palabra («REWE», «Hamburger Hochbahn», «Leon»)', () => {
    expect(categorize(row('REWE Markt GmbH')).categoryId).toBe('groceries');
    expect(categorize(row('Hamburger Hochbahn AG')).categoryId).toBe('transport');
    expect(categorize(row('Restaurante Leon')).categoryId).toBe('dining');
  });

  it('reconoce el comercio detrás de una pasarela de pago', () => {
    expect(categorize(row('PayPal Europe S.a.r.l.', -1299, 'Ihr Einkauf bei Spotify AB')).categoryId).toBe('subscriptions');
  });

  it('reconoce nombres cortados o con una letra mal, con confianza media', () => {
    const c = categorize(row('STARBUCK COFFEE 4411'));
    expect(c.categoryId).toBe('dining');
    const typo = categorize(row('MCDONLADS 0231'));
    expect(typo.categoryId).toBe('dining');
    expect(typo.confidence).not.toBe('high');
  });

  it('no inventa categoría para personas ni referencias sueltas', () => {
    expect(categorize(row('Max Mustermann', -5000, 'Danke fürs Auslegen')).via).toBe('default');
    expect(categorize(row('', -2500, '2026110100123')).via).toBe('default');
  });

  it('aprende de lo que la persona ya categorizó para ese comercio', () => {
    const nuevo = row('Yilmaz Neukölln', -450);
    expect(categorize(nuevo).via).toBe('default');
    const historia = buildHistory([
      { note: 'Yilmaz Neukölln', categoryId: 'leisure' },
      { note: 'Yilmaz Neukölln', categoryId: 'leisure' },
    ]);
    const c = categorize(row('YILMAZ NEUKOELLN', -450), historia);
    expect(c.categoryId).toBe('leisure');
    expect(c.via).toBe('history');
  });

  it('el historial no manda si la persona se contradice o sólo usó «Otros»', () => {
    const dividido = buildHistory([
      { note: 'Zorvex Lumtal', categoryId: 'leisure' }, { note: 'Zorvex Lumtal', categoryId: 'shopping' },
    ]);
    expect(categorize(row('Zorvex Lumtal'), dividido).via).toBe('default');
    const otros = buildHistory([{ note: 'Zorvex Lumtal', categoryId: 'other_expense' }, { note: 'Zorvex Lumtal', categoryId: 'other_expense' }]);
    expect(categorize(row('Zorvex Lumtal'), otros).via).toBe('default');
  });

  it('el historial no cambia lo que las reglas ya saben', () => {
    const mala = buildHistory([{ note: 'REWE', categoryId: 'leisure' }, { note: 'REWE', categoryId: 'leisure' }]);
    expect(categorize(row('REWE Markt'), mala).categoryId).toBe('groceries');
  });
});

describe('inversiones y préstamos', () => {
  it.each([
    ['TRADE REPUBLIC Wertpapierkauf ETF', 'investing'],
    ['Scalable Capital Sparplan', 'investing'],
    ['COMPRA ACCIONES BOLSA MADRID', 'investing'],
    ['Binance Bitcoin', 'investing'],
    ['PRES.32305541197', 'debt'],
    ['PRESTAMOS B.DIGITAL', 'debt'],
    ['TELEKOM DEUTSCHL.', 'utilities'],
    ['DB VERTRIEB GMBH', 'transport'],
  ])('%s → %s', (name, cat) => {
    expect(categorize({ date: '2026-06-01', amountMinor: -5000, name }).categoryId).toBe(cat);
  });

  it('lo que entra desde un bróker sigue siendo ingreso por inversiones', () => {
    expect(categorize({ date: '2026-06-01', amountMinor: 1200, name: 'Trade Republic Dividende' }).categoryId).toBe('investments');
  });
});

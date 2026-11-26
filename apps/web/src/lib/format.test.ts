import { describe, expect, it } from 'vitest';
import { addDays, parseAmount, relativeDay, shiftMonth } from './format';
import { categoryColor, familyOf } from './categories';
import { setLangNow } from './i18n';

describe('parseAmount', () => {
  it('acepta formatos europeos y anglosajones', () => {
    expect(parseAmount('12,5')).toBe(1250);
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('  9 €')).toBe(900);
  });

  it('rechaza entradas no válidas o fuera de rango', () => {
    for (const bad of ['', 'abc', '0', '-5', '1,234,56', '12.345', '1e3', '999999999999']) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe('fechas', () => {
  it('suma días cruzando mes y año', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('desplaza meses', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
  });

  it('etiqueta hoy y ayer en cada idioma', () => {
    for (const [lang, hoy, ayer] of [['es', 'Hoy', 'Ayer'], ['en', 'Today', 'Yesterday'], ['it', 'Oggi', 'Ieri'], ['de', 'Heute', 'Gestern']] as const) {
      setLangNow(lang);
      expect(relativeDay('2026-11-24', '2026-11-24')).toBe(hoy);
      expect(relativeDay('2026-11-23', '2026-11-24')).toBe(ayer);
    }
    setLangNow('en');
  });
});

describe('categorías', () => {
  it('el color sigue a la familia, no al orden', () => {
    expect(categoryColor('groceries')).toBe(familyOf('groceries').color);
  });
});

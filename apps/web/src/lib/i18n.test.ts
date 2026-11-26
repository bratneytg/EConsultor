import { afterEach, describe, expect, it } from 'vitest';
import { getLang, locale, plural, setLangNow, t } from './i18n';

afterEach(() => setLangNow('en'));

describe('t()', () => {
  it('traduce a cada idioma y sustituye variables', () => {
    setLangNow('en');
    expect(t('Guardar')).toBe('Save');
    expect(t('Hay {n} cosas', { n: 3 })).toBe('Hay 3 cosas'); // sin traducción: sale el español, nunca una clave rota
    expect(t('{n} artículos', { n: 4 })).toBe('4 articles');
    setLangNow('it');
    expect(t('Guardar')).toBe('Salva');
    setLangNow('de');
    expect(t('Guardar')).toBe('Speichern');
    setLangNow('es');
    expect(t('Guardar')).toBe('Guardar');
  });
  it('la configuración regional sigue al idioma', () => {
    setLangNow('de');
    expect(getLang()).toBe('de');
    expect(locale()).toBe('de-DE');
    setLangNow('it');
    expect(locale()).toBe('it-IT');
  });
  it('plural elige la forma y la traduce', () => {
    setLangNow('es');
    expect(plural(1, 'un día', '{n} días')).toBe('un día');
    expect(plural(3, 'un día', '{n} días')).toBe('3 días');
  });
});

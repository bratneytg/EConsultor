import { describe, expect, it } from 'vitest';
import { ARTICULOS, TEMAS, articulosEn, buscar } from './ayuda';

describe('ayuda', () => {
  it('los ids son únicos y cada tema existe', () => {
    expect(new Set(ARTICULOS.map((a) => a.id)).size).toBe(ARTICULOS.length);
    for (const a of ARTICULOS) expect(TEMAS).toContain(a.tema);
  });
  it('busca sin importar tildes ni mayúsculas', () => {
    expect(buscar('RECORDATORIO')[0]?.id).toBe('recordatorio-diario');
    expect(buscar('notificacion').map((a) => a.id)).toContain('recordatorio-diario');
    expect(buscar('extracto')[0]?.id).toMatch(/importar|modos/);
  });
  it('todas las palabras deben aparecer y sin consulta devuelve todo', () => {
    expect(buscar('racha zzzzzz')).toHaveLength(0);
    expect(buscar('')).toHaveLength(ARTICULOS.length);
  });
  it('las acciones apuntan a rutas de la app', () => {
    for (const a of ARTICULOS) if (a.accion) expect(a.accion.to).toMatch(/^\//);
  });
});

describe('ayuda traducida', () => {
  it('cada artículo está en los cuatro idiomas con la misma estructura', () => {
    for (const lang of ['en', 'it', 'de'] as const) {
      const lista = articulosEn(lang);
      expect(lista).toHaveLength(ARTICULOS.length);
      lista.forEach((a, i) => {
        const o = ARTICULOS[i]!;
        expect(a.id).toBe(o.id);
        // Traducido de verdad (no queda el título en español) y con las mismas líneas y listas.
        expect(a.titulo, `${lang}/${a.id}`).not.toBe(o.titulo);
        expect(a.texto).toHaveLength(o.texto.length);
        a.texto.forEach((l, j) => expect(l.startsWith('- ')).toBe(o.texto[j]!.startsWith('- ')));
        if (o.accion) expect(a.accion?.etiqueta).not.toBe(o.accion.etiqueta);
      });
    }
  });
  it('la búsqueda funciona en el idioma de la app', () => {
    expect(buscar('reminder', articulosEn('en')).map((a) => a.id)).toContain('recordatorio-diario');
    expect(buscar('promemoria', articulosEn('it')).map((a) => a.id)).toContain('recordatorio-diario');
    expect(buscar('Erinnerung', articulosEn('de')).map((a) => a.id)).toContain('recordatorio-diario');
  });
});

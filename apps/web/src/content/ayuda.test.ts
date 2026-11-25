import { describe, expect, it } from 'vitest';
import { ARTICULOS, TEMAS, buscar } from './ayuda';

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

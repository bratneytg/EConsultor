import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compareVersions, markSeen, pendingReleases, RELEASES } from './novedades';

const OLD = '2026-01-01T00:00:00Z';
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() });
});

describe('novedades', () => {
  it('compara versiones como números', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('la versión más reciente del historial es la de la app (si se sube la versión hay que documentarla)', () => {
    expect(RELEASES[0]!.version).toBe(__APP_VERSION__);
    const versions = RELEASES.map((r) => r.version);
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)));
    for (const r of RELEASES) expect(r.changes.length).toBeGreaterThan(0);
  });

  it('cuenta recién creada: no se enseña nada y se da por vista', () => {
    const now = Date.parse('2026-11-26T10:00:00Z');
    expect(pendingReleases('u1', '2026-11-26T09:50:00Z', '1.2.0', now)).toEqual([]);
    expect(pendingReleases('u1', OLD, '1.2.0', now)).toEqual([]);
  });

  it('cuenta antigua que nunca vio novedades: solo la última', () => {
    const r = pendingReleases('u2', OLD, '1.2.0', Date.parse('2026-11-26T10:00:00Z'));
    expect(r.map((x) => x.version)).toEqual(['1.2.0']);
  });

  it('tras actualizar se enseñan las versiones posteriores a la vista, y solo una vez', () => {
    markSeen('u3', '1.1.0');
    expect(pendingReleases('u3', OLD, '1.2.0').map((x) => x.version)).toEqual(['1.2.0']);
    markSeen('u3', '1.2.0');
    expect(pendingReleases('u3', OLD, '1.2.0')).toEqual([]);
  });

  it('cada cuenta de un mismo dispositivo lleva su propio registro', () => {
    markSeen('a', '1.2.0');
    expect(pendingReleases('a', OLD, '1.2.0')).toEqual([]);
    expect(pendingReleases('b', OLD, '1.2.0')).toHaveLength(1);
  });
});

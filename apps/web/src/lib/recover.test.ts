import { describe, expect, it } from 'vitest';
import { isChunkError } from './recover';

describe('recuperación tras una actualización a medias', () => {
  it('reconoce los errores de módulos que ya no existen en el servidor', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Settings-abc.js'))).toBe(true);
    expect(isChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(Object.assign(new Error('Loading chunk 12 failed.'), { name: 'ChunkLoadError' }))).toBe(true);
  });
  it('no confunde un fallo normal de la pantalla con un chunk perdido', () => {
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });
});

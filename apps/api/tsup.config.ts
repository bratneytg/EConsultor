import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // El contrato compartido es TypeScript sin compilar: se incluye dentro del bundle.
  noExternal: ['@econsultor/shared'],
});

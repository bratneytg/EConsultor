import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/informe.ts', 'src/panel.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  // El contrato compartido es TypeScript sin compilar: se incluye dentro del bundle.
  noExternal: ['@econsultor/shared'],
  // La página del panel es un HTML suelto: se copia junto al código compilado.
  onSuccess: 'mkdir -p dist/panel && cp src/panel/index.html dist/panel/index.html',
});

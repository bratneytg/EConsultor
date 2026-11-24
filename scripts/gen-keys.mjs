// Genera secretos aleatorios para el archivo .env (nunca los subas al repositorio).
//   npm run gen:keys
import { randomBytes } from 'node:crypto';

const b64 = (n) => randomBytes(n).toString('base64');
console.log('# Copia estas líneas a apps/api/.env');
console.log(`ACCESS_TOKEN_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`DATA_ENCRYPTION_KEY=${b64(32)}`);

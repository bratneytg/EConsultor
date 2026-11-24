# Seguridad

Los datos financieros son sensibles. Esta es la superficie de ataque y cómo se cubre cada punto.

## Controles implementados

| Amenaza | Control | Dónde |
| --- | --- | --- |
| Robo de la base de contraseñas | **scrypt** (N=2¹⁶, r=8, p=2, sal aleatoria, parámetros embebidos para poder subirlos); política de longitud ≥ 10, sin contraseñas comunes ni derivadas del email | `security/password.ts` |
| Fuerza bruta / *credential stuffing* | Límite por IP (10/min en rutas de acceso) + bloqueo de cuenta 15 min tras 5 fallos (también en el 2.º factor) | `routes/auth.ts` |
| Enumeración de usuarios | Mismo error y mismo coste (hash ficticio) exista o no el email | `dummyVerify` |
| Robo de contraseña | **MFA TOTP** (RFC 6238; vectores oficiales en tests), anti-replay (paso ya usado se rechaza), 10 códigos de recuperación de un solo uso guardados como hash | `security/totp.ts` |
| Secreto TOTP en la BD | Cifrado AES-256-GCM con `DATA_ENCRYPTION_KEY` | `security/crypto.ts` |
| XSS roba el token | Access token (10 min) **solo en memoria**; el refresh va en cookie `httpOnly` + `SameSite=Strict` + `Secure` (prod) con ruta limitada a `/api/auth` | `lib/api.ts` |
| Robo del refresh token | **Rotación** en cada uso; si un token ya rotado reaparece, se revoca toda la familia (con ventana de gracia de 10 s para pestañas concurrentes) | `/auth/refresh` |
| CSRF | `SameSite=Strict` + cabecera obligatoria `X-Requested-With` + CORS restringido a `PUBLIC_ORIGIN` | `server.ts` |
| Inyección de scripts | CSP estricta (`script-src 'self'`, sin inline), `frame-ancestors 'none'`, `nosniff`, HSTS en producción, `Referrer-Policy: no-referrer` | `server.ts` (helmet) |
| Acceso a datos de otro usuario (IDOR) | Todas las operaciones del almacén reciben `userId`; tests de aislamiento | `store/*`, `test/api.test.ts` |
| Entradas maliciosas | Validación zod en cada ruta, importes enteros acotados, fechas reales, límite de cuerpo 100 kB | `shared`, `routes/*` |
| Fugas en logs | `authorization`, `cookie` y `set-cookie` redactados; sin importes en logs | `server.ts` |
| Fichero de datos robado | AES-256-GCM en reposo (obligatorio en producción), permisos 0600, escritura atómica | `store/file-store.ts` |
| Cuenta de Google que «toma» una cuenta local | No se enlaza automáticamente por email (evita pre-registro); se valida firma, `iss`, `aud`, expiración y `email_verified` | `/auth/google` |
| Privacidad frente a la IA | Solo se envían **agregados anónimos** (porcentajes, medias); jamás notas, fechas exactas ni movimientos individuales | `advice/claude.ts` |
| Perfil financiero expuesto | Se calcula en servidor y nunca se serializa; test que busca sus campos en todas las respuestas | `test/api.test.ts` |
| Derechos RGPD | Exportar (art. 20) y eliminar la cuenta (art. 17) con confirmación | `/me/export`, `DELETE /me` |

## Cuenta de pruebas `admin/admin`

Es una credencial pública a propósito, para probar la interfaz. Se limita así: solo existe con `ALLOW_DEMO_DATA=true`; no tiene privilegios (es un usuario más, con sus datos de demostración); el límite de intentos y el bloqueo siguen activos; y en producción real hay que poner `ALLOW_DEMO_DATA=false`, lo que impide crearla.

## Reglas operativas

1. **Nunca** subas `.env` ni `data/` (ya están en `.gitignore`).
2. Genera secretos con `npm run gen:keys`; rota `ACCESS_TOKEN_SECRET` si sospechas filtración (cierra todas las sesiones).
3. **Guarda `DATA_ENCRYPTION_KEY` en un sitio aparte de las copias de seguridad**; sin ella los datos no se pueden recuperar.
4. Expón el servicio solo por HTTPS (Cloudflare Tunnel / Tailscale / Caddy). El puerto 8787 escucha en `127.0.0.1` por defecto.
5. Si hay proxy delante, activa `TRUST_PROXY=true` para que los límites usen la IP real.
6. Mantén Node y dependencias al día (`npm audit` en CI).

## Pendiente (ordenado por prioridad)

- Verificación de email y recuperación de contraseña (requiere SMTP).
- Passkeys / WebAuthn como alternativa fuerte al TOTP.
- Copias de seguridad cifradas y automáticas; prueba de restauración.
- Registro de auditoría con alertas (ya se guardan eventos: login, fallos, MFA, reutilización de refresh).
- Sesiones listadas por dispositivo con revocación individual.
- Revisión externa / prueba de penetración antes de abrirlo a terceros.
- Aviso legal, política de privacidad y base jurídica del tratamiento antes de ofrecerlo al público (RGPD).

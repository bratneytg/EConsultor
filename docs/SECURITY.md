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
| Perfil financiero expuesto | Se calcula en servidor y ninguna ruta de la API lo serializa; test que busca sus campos en todas las respuestas | `test/api.test.ts` |
| Perfiles en el panel del administrador | **Única excepción, deliberada y apagada por defecto**: el panel (servicio aparte, solo red privada Tailscale, contraseña propia) puede mostrarlos con `PANEL_VER_PERFILES=true` (`servidor.sh perfiles on`, pide confirmación). Es dato personal: debe constar en el aviso de privacidad; sin 5 movimientos no se calcula perfil; no incluye notas ni movimientos sueltos | `panel/perfiles.ts`, `test/panel-perfiles.test.ts` |
| Evaluación psico-económica en el panel | **Segunda excepción, aún más sensible y apagada por defecto**: lectura de conducta (Money Scripts, tacaño↔derrochador, sesgo al presente, inflación del estilo de vida, efecto día de cobro, autocorrección, hábito, ahorro planificado, colchón; con evolución mensual, palancas en euros e hipótesis alternativas) dentro de «Perfiles», solo con `PANEL_VER_PSICO=true` (`servidor.sh psico on`, pide confirmación) y con los perfiles ya activos. Es inferencia sobre una persona, no un diagnóstico: debe constar en el aviso de privacidad (RGPD, transparencia y derecho a oponerse), usarse solo con personas de confianza y no sale por la API de la app. Se calcula solo con reglas en el servidor: no usa IA ni envía nada a terceros; no incluye notas ni comercios | `panel/psico.ts`, `panel/psico-metricas.ts`, `test/panel-psico.test.ts` |
| Reportes de fallos | Requiere sesión, límite por IP y 10/día por persona, mensaje ≤ 2000 caracteres; guarda pantalla y dispositivo, no importes; se borran al eliminar la cuenta; el panel los escapa | `POST /api/feedback` |
| Sesión olvidada abierta | Cierre por inactividad (10 min por defecto, `IDLE_TIMEOUT_MIN`): el servidor guarda la última actividad real de cada sesión (solo cuenta la que lleva `X-User-Active`, es decir, con interacción de la persona; el refresco automático no la renueva) y responde 401 `idle_timeout` revocando la familia de tokens. La persona puede excluirse con «Mantener conectado» | `security/idle.ts`, `server.ts`, `/auth/refresh` |
| Phishing / contraseña robada | **Passkeys (WebAuthn)** con huella o PIN del dispositivo: la clave privada no sale del móvil y está ligada al dominio (`rpID`), así que una web falsa no puede usarla. Verificación de usuario obligatoria, desafío de un solo uso (5 min), contador anti-clonado, máx. 5 por cuenta, no se puede quitar el último método de acceso. Solo se guarda la clave pública; no se exporta ni se muestra | `routes/passkeys.ts`, `test/sesion.test.ts` |
| Phishing / contraseña robada en la app de Android | La huella del WebView de Android (que no admite WebAuthn) usa `BiometricPrompt` y una clave AES-GCM del Keystore del teléfono que solo se desbloquea con la huella; el teléfono guarda un secreto aleatorio cifrado y el servidor solo su SHA-256 (`appBiometrics`). Mismas reglas que los passkeys: máx. 5, no quita el último método, cuenta bloqueada tras intentos fallidos | `routes/passkeys.ts` (`/auth/passkey/biometric/*`) |
| Mezcla de datos entre cuentas | Cada movimiento lleva su `account` (≤ 40 caracteres) dentro del mismo usuario; los duplicados se buscan solo en la misma cuenta y el solape entre cuentas solo avisa, nunca borra | `modules/import/service.ts`, `test/cuentas.test.ts` |
| Idioma como vector de inyección | `X-Lang` solo se acepta si es uno de `en/es/it/de`; el idioma nunca se usa como ruta ni como clave de caché sin esa comprobación | `lib/i18n.ts`, `server.ts` |
| Consejos «a fondo» e IA | El análisis detallado es local. Solo con el botón de consentimiento se envía a la IA un resumen de comercios e importes (sin fechas ni notas; IBAN, correos y números largos eliminados); requiere Premium, clave y ≥ 15 movimientos | `advice/detailed.ts`, `advice/claude.ts` |
| Premium para todos | `PREMIUM_FOR_ALL` solo cambia el plan efectivo; no abre ninguna ruta de pruebas (`ALLOW_DEMO_DATA` sigue en `false`) | `lib/plan.ts` |
| Derechos RGPD | Exportar (art. 20) y eliminar la cuenta (art. 17) con confirmación | `/me/export` (incluye periódicos y categorías propias), `DELETE /me` |

## Cuenta de pruebas `admin/admin`

Es una credencial pública a propósito, para probar la interfaz. Se limita así: solo existe con `ALLOW_DEMO_DATA=true`; no tiene privilegios (es un usuario más, con sus datos de demostración); el límite de intentos y el bloqueo siguen activos; y en producción real hay que poner `ALLOW_DEMO_DATA=false`, lo que impide crearla.

## Importación de extractos

- Rutas `/api/import/preview` y `/commit`: requieren sesión, límite de 20 peticiones por minuto, cuerpo máximo de 16 MB (vista previa) y 4 MB (confirmar), 5000 movimientos por importación.
- El análisis es local en el servidor. La IA solo se usa si el usuario marca la casilla y hay `ANTHROPIC_API_KEY`; antes de enviar se eliminan IBAN, emails y números largos.
- Los Excel (.xlsx) y hojas de LibreOffice (.ods) se leen solo como datos: se descomprime el zip y se interpreta su XML (cadenas, números, fechas); nunca se ejecutan macros, fórmulas ni enlaces externos. Límites: 120 MB descomprimidos en total, 60 MB por parte, 60 000 filas y 80 columnas, para frenar «zip bombs». Los `.xls` antiguos no se admiten. Sin librerías de Excel de terceros (solo `fflate` para el zip).
- El signo de los importes se decide en servidor (`signs.ts`): extractos de tarjeta con gastos en positivo, columnas Dare/Avere o «tipo», y descripciones. La persona puede invertirlo con un botón.
- La categorización usa reglas, el historial de la propia persona (si ya categorizó ese comercio, se repite su criterio) y, solo con consentimiento, la IA. Lo que no se puede saber se deja en «Otros» y se avisa; no se inventa.
- Los IBAN del extracto no se guardan en las notas. La confirmación valida categoría, fecha (no futura) e importe en servidor; el tipo gasto/ingreso se deduce de la categoría.
- Los datos de un extracto real son sensibles. Mientras el despliegue de Render use disco efímero y `ALLOW_DEMO_DATA=true`, **no importes tus movimientos reales ahí**: usa tu servidor propio con `ALLOW_DEMO_DATA=false`.

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

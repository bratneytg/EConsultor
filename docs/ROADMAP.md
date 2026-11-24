# Hoja de ruta

## Siguiente (necesita una decisión o dato tuyo)

0. **Antes de usar datos reales:** poner `ALLOW_DEMO_DATA=false` (elimina la cuenta `admin/admin` y los botones de demostración) y desplegar con base de datos persistente.

1. **Base de datos.** Cuando decidas motor (recomendado: PostgreSQL), se implementa `PostgresStore` contra el puerto `Store` (`apps/api/src/store/types.ts`) y se añaden migraciones. Nada más cambia.
2. **Acceso con Google.** La API (`POST /api/auth/google`) ya valida el ID token. Falta el botón en la web: crear un *OAuth Client ID* en Google Cloud, ponerlo en `GOOGLE_CLIENT_ID` y permitir `accounts.google.com` en la CSP (`script-src`, `frame-src`, `connect-src`).
3. **Claves de notificaciones push** (`npx web-push generate-vapid-keys`) y dominio HTTPS para probar en iPhone.
4. **Clave de IA** (`ANTHROPIC_API_KEY`) para los consejos Premium. Sin clave, Premium usa reglas.
5. **Cobro del plan Premium.** Hoy hay un interruptor de demostración (`/api/dev/plan`, desactivado en producción). Opciones: Stripe en web, o compras integradas si se publica en la App Store.

## Producto

- Presupuestos por categoría con avisos al acercarse al límite.
- Objetivos de ahorro con progreso visual y fecha estimada.
- Movimientos recurrentes (alquiler, nómina, suscripciones) generados automáticamente.
- Importar extractos bancarios: **hecho** para CSV y PDF con texto. Pendiente: Camt.053/MT940, OCR para PDF escaneados y aprender de tus correcciones de categoría.
- Varias cuentas y monedas, con conversión.
- Escenarios «¿y si…?» sobre la previsión (recortar X, subir ingresos Y).
- Internacionalización (hoy: español).
- Widgets de iOS / acceso rápido vía Capacitor.

## Plataforma

- Verificación de email, recuperación de contraseña, passkeys (ver `SECURITY.md`).
- Observabilidad: métricas y trazas (OpenTelemetry), alertas.
- Copias de seguridad cifradas y prueba de restauración.
- Tests E2E (Playwright) y de accesibilidad automatizados en CI.
- Empaquetado con Capacitor para App Store / Google Play.

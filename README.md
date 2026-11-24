# EConsultor

Planificador de economía personal: anota gastos e ingresos en segundos, entiende a dónde va tu dinero con gráficas muy cuidadas y recibe consejos a medida (reglas + IA).

Funciona como **PWA** (aplicación web instalable): en iPhone se añade a la pantalla de inicio y se comporta como una app nativa, con recordatorio diario por notificación push. Más adelante puede empaquetarse con Capacitor para la App Store sin reescribir nada.

## Dos interfaces

- **Sencilla** (por defecto): el mes en un vistazo —balance, estado en una frase, ingresos/gastos/ahorro—, dos gráficos (saldo del mes y en qué gastas) y tres consejos en tarjetas.
- **Profesional**: el análisis completo (río de dinero, 12 meses, mapa de calor, patrón semanal, pulso financiero…).

Se cambia con el selector de la cabecera del Resumen o en *Ajustes → Interfaz*, y la elección se guarda en el perfil, así que te acompaña a cualquier dispositivo.

## Cuenta de pruebas

Con `ALLOW_DEMO_DATA` activo (por defecto en desarrollo y en el despliegue de pruebas de Render) existe una cuenta maestra: usuario **`admin`**, contraseña **`admin`**. Tiene plan Premium y seis meses de datos de demostración que se recargan en cada arranque; la contraseña, el bloqueo y el 2FA se restablecen también. No tiene privilegios especiales. **Con `ALLOW_DEMO_DATA=false` (producción real) la cuenta no existe**, así que esas credenciales públicas dejan de servir.

## Qué incluye

| Área | Estado |
| --- | --- |
| Registro e inicio de sesión (scrypt, bloqueo por intentos, tokens de corta vida con renovación rotatoria) | ✅ |
| Verificación en dos pasos (TOTP + códigos de recuperación) | ✅ |
| Acceso con Google (API lista; falta el botón en la web, ver `docs/ROADMAP.md`) | 🟡 |
| Movimientos: alta, edición, borrado, búsqueda, filtros | ✅ |
| Gráficas propias: saldo con previsión, «río» de dinero (Sankey), reparto por familias, 12 meses, mapa de calor, patrón semanal, pulso financiero | ✅ |
| Recordatorio diario (Web Push, a la hora local del usuario, solo si no ha anotado nada) | ✅ (necesita claves VAPID) |
| Perfil financiero interno (nunca se muestra ni se expone por la API) | ✅ |
| Consejos: genéricos y específicos por reglas; con IA (Claude) en el plan Premium | ✅ (IA necesita `ANTHROPIC_API_KEY`) |
| Plan gratis / Premium (interruptor de demostración; falta pasarela de pago) | 🟡 |
| Exportar y eliminar la cuenta (RGPD) | ✅ |
| Base de datos | ⏳ Archivo cifrado por ahora; el puerto `Store` está listo para Postgres |

## Arranque rápido (Windows / PowerShell)

Necesitas [Node.js 20+](https://nodejs.org).

```powershell
git clone https://github.com/bratneytg/EConsultor.git
cd EConsultor
npm install
npm run dev
```

Abre <http://localhost:5173>, crea una cuenta y, en *Movimientos*, pulsa **Cargar datos de demostración** para ver todas las gráficas con seis meses de datos.
Desde el móvil (misma wifi) usa la dirección de red que muestra Vite, aunque las notificaciones push e instalar la PWA en iOS exigen HTTPS (ver más abajo).

Comandos útiles:

```powershell
npm test            # tests de la API (seguridad, MFA, aislamiento de datos, analítica…)
npm run typecheck   # TypeScript estricto en todos los paquetes
npm run build       # compila API y web
npm run gen:keys    # genera ACCESS_TOKEN_SECRET y DATA_ENCRYPTION_KEY para producción
```

## Estructura

```
apps/api        Fastify + TypeScript. Auth, MFA, movimientos, analítica, perfil, consejos, recordatorios
apps/web        React + Vite (PWA). Gráficas SVG propias, hoja de anotar, ajustes de seguridad
packages/shared Contrato compartido (esquemas zod, tipos, categorías)
docs/           Arquitectura, seguridad, diseño y hoja de ruta
```

## Servidor propio en tu PC

La API puede servir también la web compilada, así que **un solo proceso** basta:

```powershell
npm run gen:keys                      # copia las dos líneas a apps/api/.env
npm run build
$env:NODE_ENV="production"; $env:STATIC_DIR="apps/web/dist"; $env:PUBLIC_ORIGIN="https://tu-dominio"
npm run start -w @econsultor/api
```

Para usarlo desde el iPhone **necesitas HTTPS** (requisito de iOS para instalar la PWA y recibir push). Dos opciones cómodas sin abrir puertos del router:

1. **Cloudflare Tunnel** (dominio propio): `cloudflared tunnel` apuntando a `http://127.0.0.1:8787`.
2. **Tailscale Funnel/Serve**: HTTPS con certificado válido hacia tu PC, sin dominio.

Con Docker: `docker compose up -d` (ver `docker-compose.yml`; incluye un perfil opcional con Caddy para HTTPS automático).

Notificaciones push: genera claves con `npx web-push generate-vapid-keys` y ponlas en `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

## Probar en Render (móvil, tablet, otros navegadores)

El repositorio incluye `render.yaml`, un *Blueprint* que despliega todo en un solo servicio con HTTPS (necesario para instalar la PWA en iPhone).

1. En [render.com](https://render.com): **New → Blueprint** y elige el repositorio `EConsultor` (la primera vez hay que dar permiso a Render en GitHub).
2. Confirma. Render genera solo `ACCESS_TOKEN_SECRET` y `DATA_ENCRYPTION_KEY`; el origen público se toma de `RENDER_EXTERNAL_URL`.
3. Cuando termine, abre `https://econsultor-xxxx.onrender.com`, crea una cuenta y pulsa **Cargar datos de demostración**.
4. En iPhone: Safari → Compartir → **Añadir a pantalla de inicio**.

Limitaciones del plan gratuito: el servicio se duerme tras ~15 min sin uso (la primera carga tarda ~30 s) y **el disco es efímero**, así que los datos se borran al reiniciar o redesplegar. Sirve para probar la interfaz, no para datos reales. Las notificaciones push solo funcionan si añades las claves VAPID en el panel de Render.

## Documentación

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — decisiones y mapeo a los seis pilares del *Well-Architected Framework*
- [`docs/SECURITY.md`](docs/SECURITY.md) — modelo de amenazas y controles
- [`docs/DESIGN.md`](docs/DESIGN.md) — sistema de diseño y reglas de las gráficas
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — qué falta y en qué orden

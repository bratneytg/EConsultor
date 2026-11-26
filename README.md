# EConsultor

Planificador de economía personal: anota gastos e ingresos en segundos, entiende a dónde va tu dinero con gráficas muy cuidadas y recibe consejos a medida (reglas + IA).

Funciona como **PWA** (aplicación web instalable): en iPhone se añade a la pantalla de inicio y se comporta como una app nativa, con recordatorio diario por notificación push. Más adelante puede empaquetarse con Capacitor para la App Store sin reescribir nada.

## App de Android

Hay una app para Android en `apps/android/` (abre tu EConsultor y añade el aviso diario del teléfono). Se compila en GitHub Actions; ver [apps/android/README.md](apps/android/README.md).

## Dos interfaces

- **Sencilla** (por defecto): el mes en un vistazo —balance, estado en una frase, ingresos/gastos/ahorro—, dos gráficos (saldo del mes y en qué gastas) y tres consejos en tarjetas.
- **Profesional**: el análisis completo (río de dinero, 12 meses, mapa de calor, patrón semanal, pulso financiero…).

Se cambia con el selector de la cabecera del Resumen o en *Ajustes → Interfaz*, y la elección se guarda en el perfil, así que te acompaña a cualquier dispositivo.

## Cuenta de pruebas

Con `ALLOW_DEMO_DATA` activo (por defecto en desarrollo y en el despliegue de pruebas de Render) existe una cuenta maestra: usuario **`admin`**, contraseña **`admin`**. Tiene plan Premium y seis meses de datos de demostración que se recargan en cada arranque; la contraseña, el bloqueo y el 2FA se restablecen también. No tiene privilegios especiales. **Con `ALLOW_DEMO_DATA=false` (producción real) la cuenta no existe**, así que esas credenciales públicas dejan de servir.

## Importar extractos bancarios

El botón **«Importar extractos bancarios»** (en *Movimientos* y en *Ajustes → Tus datos*) acepta el CSV o el PDF de tu banco. Funciona **sin IA y sin conexión a terceros**: el servidor lee el archivo, detecta fechas e importes (formatos ISO, `dd.mm.aaaa`, `1.234,56` o `1,234.56`), clasifica por reglas (comercios alemanes, españoles e ingleses, categorías de N26, traspasos entre tus cuentas) y te enseña el resultado para corregirlo antes de guardar. Lo que ya existe no se duplica. Al importar, el perfil financiero oculto se recalcula solo, porque se deriva de los movimientos.

- **CSV** (recomendado): N26 → web app → descargar extracto en CSV. También vale cualquier CSV con columnas de fecha e importe.
- **PDF**: se lee su texto con `unpdf`. Es una lectura heurística: va bien con tablas simples; un PDF escaneado (imagen) no tiene texto y no se puede leer sin OCR.
- **IA opcional**: con `ANTHROPIC_API_KEY` aparece la casilla «Mejorar con IA», que envía a Claude solo las descripciones de lo que las reglas no reconocen (sin IBAN ni emails) y ayuda con PDFs de formato raro.

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
| Consejos: pestaña «Generales» y pestaña «A fondo» (comercios, recurrentes, gastos pequeños, tendencias; con «qué hacer»); la IA es opcional y con consentimiento | ✅ (IA necesita `ANTHROPIC_API_KEY`) |
| Cierre por inactividad (10 min, configurable con «Mantener conectado») y acceso con huella (passkeys) | ✅ (la huella exige HTTPS y `PUBLIC_ORIGIN` correcto) |
| Importación de CSV, Excel (.xlsx), LibreOffice (.ods) y PDF; entiende extractos de cuenta y de tarjeta (gastos en positivo, p. ej. Nexi), fechas/números de ES-DE-IT, con botón «Invertir gastos e ingresos» | ✅ |
| Importación con categorización por reglas, aprendizaje de tu historial y detección de comercios tras PayPal | ✅ |
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

## Servidor casero: scripts de mantenimiento

`scripts/servidor.sh` se ejecuta dentro del servidor (Ubuntu + Docker + Tailscale), en la carpeta del proyecto:

| Comando | Qué hace |
| --- | --- |
| `bash scripts/servidor.sh informe` | Informe en lenguaje claro del servidor (memoria, disco, app, acceso, copias) y de la base de datos |
| `bash scripts/servidor.sh actividad [días]` | Usuarios nuevos, entradas, importaciones y avisos de seguridad del periodo |
| `bash scripts/servidor.sh copias` | Configura las copias cifradas con restic (contraseña generada, copia nocturna a las 03:30) y hace la primera |
| `bash scripts/servidor.sh copiar` | Hace una copia ahora |
| `bash scripts/servidor.sh restaurar [ID]` | Lista las copias o restaura una (con confirmación y respaldo previo) |
| `bash scripts/servidor.sh estado` | Resumen técnico corto para pegar en un chat |
| `bash scripts/servidor.sh actualizar` | Descarga cambios de GitHub y reconstruye si los hay |
| `bash scripts/servidor.sh actualizaciones` | Programa `actualizar` cada 10 minutos |
| `bash scripts/servidor.sh publico` / `privado` | Abre la app a internet con Tailscale Funnel / la deja solo en tu red privada |
| `bash scripts/servidor.sh panel` | Instala o actualiza el panel personal (ver abajo) y muestra su contraseña la primera vez |
| `bash scripts/servidor.sh direccion` | Tras renombrar el equipo o la red en Tailscale: rehace las asignaciones, actualiza `PUBLIC_ORIGIN` y reinicia la app |
| `bash scripts/servidor.sh activar` | Activa Premium para todos (`PREMIUM_FOR_ALL`), genera las claves de avisos push (VAPID) y avisa de lo que aún falta (clave de IA, Google) |
| `bash scripts/servidor.sh perfiles on\|off` | Muestra u oculta la pestaña «Perfiles financieros» del panel (apagada por defecto; pide confirmar) |
| `bash scripts/servidor.sh apk URL` | Pone el enlace de descarga de la app de Android en Ajustes y Ayuda |
| `bash scripts/servidor.sh panel-clave` / `panel-parar` | Cambia la contraseña del panel / lo apaga y lo quita de Tailscale |

Los informes los genera `apps/api/src/informe.ts` (dentro del contenedor, como `node dist/informe.js`): leen la base de datos
en modo solo lectura y no muestran importes, notas, contraseñas ni correos completos.


### Panel personal de administración

Una web de solo lectura, **solo para el dueño del servidor**, que junta en una pantalla el estado del equipo (CPU, memoria, disco,
temperatura, red), los contenedores y sus registros, la base de datos (tamaño, cuentas, movimientos), los usuarios, la actividad y los
avisos de seguridad, las copias de seguridad y Tailscale. Con gráficos, historial de 24 h / 7 días y un botón **Actualizar**.

- `scripts/panel-recolector.py` (cron, cada minuto) deja la foto del servidor en `estado/host.json` y `estado/historial.jsonl`.
- `apps/api/src/panel.ts` (servicio `panel` de docker-compose, perfil `panel`) sirve la página y la API. Lee la base de datos cifrada
  en solo lectura y no tiene ninguna ruta que modifique nada.
- Se publica **solo** con `tailscale serve` en el puerto 8443 (red privada). Nunca con Funnel: el recolector lo vigila y el panel
  muestra una alerta roja si ocurriera. Acceso con contraseña propia (`.env.panel`), bloqueo tras 5 fallos y sesión de 12 h.
- Por defecto **no** muestra importes ni notas de los movimientos de otras personas (sí correos, IPs y eventos). Para verlos:
  `PANEL_VER_IMPORTES=true` en `.env.panel` y `docker compose --profile panel up -d panel`.

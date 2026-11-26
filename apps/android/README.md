# EConsultor para Android

Una app nativa muy fina que abre **tu** EConsultor (la web de tu servidor) a pantalla completa y le añade lo que un navegador no hace bien:

- **Aviso diario** a la hora que elijas (por defecto 9:00): lo programa el propio teléfono, llega con la app cerrada y se reprograma tras reiniciar. La hora se cambia en *Ajustes › Recordatorio diario* de la app y se sincroniza sola.
- Subir **extractos del banco** (selector de archivos), **exportar** tus datos a la carpeta Descargas, botón *atrás* de Android y atajo «Anotar gasto» (mantén pulsado el icono).
- Si no hay conexión muestra una pantalla con *Reintentar* y *Cambiar dirección del servidor*.

La cuenta, los datos y las gráficas son exactamente los de la web: no hay segunda base de datos.

## Instalar

1. Compila: GitHub → *Actions* → **Android** → *Run workflow* (también se lanza sola al tocar `apps/android/`).
2. Descarga `econsultor.apk` de la release **android-latest** (o del artefacto del workflow) en el teléfono y ábrelo; Android pedirá permitir instalar desde esa fuente.
3. Pon el enlace en la web para tus usuarios: `bash scripts/servidor.sh apk https://github.com/<usuario>/<repo>/releases/download/android-latest/econsultor.apk`

## Dirección del servidor

Se fija al compilar (`-PserverUrl=…`, por defecto `https://hub.fable-denebola.ts.net`; en GitHub puedes cambiarla con la variable de repositorio `EC_SERVER_URL`) y se puede cambiar dentro de la app desde la pantalla *Sin conexión*.

## Firma

El APK se firma con la clave de instalación personal de `signing/econsultor-sideload.jks` (válida para instalar a mano; no sirve para Google Play). Para usar tu propia clave define los secretos de GitHub `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`. Cambiar de clave obliga a desinstalar y volver a instalar la app una vez.

## Cómo está hecha

`MainActivity` (WebView que solo navega por el dominio de tu servidor; todo lo demás se abre en el navegador) + `Reminders`/`ReminderReceiver`/`BootReceiver` (AlarmManager). La web habla con la app mediante `window.EConsultorAndroid` (`apps/web/src/lib/native.ts`): `setReminder`, `saveTextFile`, `saveBinaryFile` (PDF), `setBars`, `appVersion`. Requiere Android 8+.

> Nota: este código se escribió sin poder compilar en el entorno de desarrollo (sin Android SDK); la primera compilación en GitHub es la que lo valida.

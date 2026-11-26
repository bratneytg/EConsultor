# Web de presentación de EConsultor

Sitio estático en **cuatro idiomas**: inglés por defecto (`/`) y español, italiano y alemán (`/es/`, `/it/`, `/de/`), con selector de idioma en la cabecera y el pie. Sin JavaScript, sin cookies y sin peticiones a terceros (las tipografías van incluidas). Tiene la pestaña **Log-in**, la descarga para Android, las instrucciones para iPhone y ordenador, y el listado de quién puede ver tus datos.

- Textos: `src/content.mjs` (un bloque por idioma; si cambias uno, cambia los cuatro).
- Plantillas: `src/pages.mjs`. Estilos: `src/styles.css`.
- Capturas de la app por idioma: `src/assets/img/app-resumen-{en,es,it,de}.webp` y `app-ian-{…}.webp`. Cámbialas cuando cambie el diseño de la app.

## Probarla en local

```bash
cd landing
APP_URL=http://localhost:8799 node build.mjs      # genera landing/dist
cd dist && python3 -m http.server 8801             # http://localhost:8801
```

## Subirla a Render (gratis)

1. Render › **New › Blueprint**, elige este repositorio y en *Blueprint Path* escribe `landing/render.yaml`. Se crea el sitio estático `econsultor-web` sin tocar el servicio de la app.
2. En **Environment** rellena:

| Variable | Qué es |
|---|---|
| `APP_URL` | Dirección de la app. A ella lleva «Log-in». **Obligatoria**: si falta, el despliegue falla a propósito. |
| `APK_URL` | Descarga del APK. Ya viene puesta: `https://github.com/bratneytg/EConsultor/releases/download/android-latest/econsultor.apk` (la release que publica `.github/workflows/android.yml`; el repositorio es público). Si la quitas, el botón de Android sale desactivado. |
| `PRICE` | Precio mensual de Premium en euros, solo el número (por defecto `4.99`). Cada idioma lo escribe a su manera. |
| `SITE_URL` | Dirección pública de esta web (opcional): activa `canonical`, `hreflang` y `sitemap.xml`. |
| `OWNER_NAME`, `OWNER_ADDRESS`, `CONTACT_EMAIL`, `PHONE` | Datos del aviso legal (*Impressum*). En Alemania una web con actividad comercial debe tenerlo. |

Mientras falten `OWNER_NAME`, `OWNER_ADDRESS` o `CONTACT_EMAIL`, el aviso legal muestra un aviso amarillo y la web **no se indexa** (`robots.txt` y `noindex`). Complétalos antes de darle el enlace a nadie.

## Antes de publicarla

- Revisa el aviso legal y la privacidad (`legal` en `src/content.mjs`) con un asesor o un *Lohnsteuerhilfeverein*: son un punto de partida, no asesoramiento legal.
- Si te acoges a la *Kleinunternehmerregelung*, suele añadirse la nota del § 19 UStG al aviso legal.

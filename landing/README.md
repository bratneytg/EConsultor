# Web de presentación de EConsultor

Sitio estático (sin JavaScript, sin cookies, sin peticiones a terceros: las tipografías van incluidas). Tiene la pestaña **Log-in**, la descarga para Android, las instrucciones para iPhone y ordenador, y el listado de quién puede ver tus datos.

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
| `APK_URL` | Dirección de descarga del APK (la misma que `APK_URL` del servidor). Opcional: sin ella el botón de Android sale desactivado. |
| `PRICE` | Precio de Premium que se muestra (por defecto «4,99 €»). Cámbialo si cambias el precio en Stripe. |
| `OWNER_NAME`, `OWNER_ADDRESS`, `CONTACT_EMAIL`, `PHONE` | Datos del aviso legal (*Impressum*). En Alemania una web con actividad comercial debe tenerlo. |

Mientras falten `OWNER_NAME`, `OWNER_ADDRESS` o `CONTACT_EMAIL`, el aviso legal muestra «[COMPLETAR…]» en amarillo y la web **no se indexa** (`robots.txt` y `noindex`). Complétalos antes de darle el enlace a nadie.

## Antes de publicarla

- Revisa `src/privacidad.html` y `src/impressum.html` con un asesor o un *Lohnsteuerhilfeverein*: son un punto de partida, no asesoramiento legal.
- Si te acoges a la *Kleinunternehmerregelung*, suele añadirse la nota del § 19 UStG al aviso legal.
- Las capturas de `src/assets/img` son de la app con datos de ejemplo; cámbialas cuando cambie el diseño.

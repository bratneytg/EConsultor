// Genera landing/dist a partir de landing/src, sustituyendo los datos que cambian de un despliegue a otro.
// Sin dependencias: solo Node. En Render: build `node build.mjs`, carpeta de salida `dist`.
//
// Variables de entorno (en Render › Environment):
//   APP_URL        Dirección de la app (obligatoria en Render): a ella lleva «Log-in».
//   APK_URL        Descarga del APK de Android. Si falta, el botón se enseña desactivado.
//   PRICE          Precio de Premium tal como se muestra (por defecto «4,99 €»).
//   OWNER_NAME, OWNER_ADDRESS, CONTACT_EMAIL, PHONE   Datos del Impressum (obligatorios para publicar).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'src');
const OUT = join(root, 'dist');
const env = process.env;
const enRender = !!env.RENDER;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const falta = [];

if (!env.APP_URL && enRender) {
  console.error('✗ Falta APP_URL: sin ella el botón «Log-in» no llevaría a ninguna parte. Defínela en Render › Environment.');
  process.exit(1);
}
const appUrl = env.APP_URL || 'http://localhost:8799';
try { new URL(appUrl); } catch { console.error(`✗ APP_URL no es una dirección válida: ${appUrl}`); process.exit(1); }
const apkUrl = env.APK_URL || '';
if (apkUrl) { try { new URL(apkUrl); } catch { console.error(`✗ APK_URL no es una dirección válida: ${apkUrl}`); process.exit(1); } }

/** Dato legal: si falta, queda un aviso amarillo bien visible y la página no se indexa. */
const legal = (name, label) => {
  const v = (env[name] || '').trim();
  if (v) return esc(v).replace(/\n/g, '<br>');
  falta.push(name);
  return `<span class="todo">[COMPLETAR: ${label}]</span>`;
};

const download = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
const androidBtn = apkUrl
  ? `<a class="btn btn-primary" href="${esc(apkUrl)}" download>${download}Descargar para Android</a>`
  : `<span class="btn btn-primary" aria-disabled="true" role="link">${download}Android: disponible pronto</span>`;

const phone = (env.PHONE || '').trim();
const values = {
  APP_URL: esc(appUrl),
  PRICE: esc((env.PRICE || '4,99 €').trim()),
  YEAR: String(new Date().getFullYear()),
  ANDROID_BTN_HERO: androidBtn,
  ANDROID_BTN_STEP: androidBtn,
  OWNER_NAME: legal('OWNER_NAME', 'nombre y apellidos'),
  OWNER_ADDRESS: legal('OWNER_ADDRESS', 'dirección postal'),
  CONTACT_EMAIL: (env.CONTACT_EMAIL || '').trim() ? esc(env.CONTACT_EMAIL.trim()) : (falta.push('CONTACT_EMAIL'), 'contacto@ejemplo.com'),
  PHONE_LINE: phone ? `<br>Teléfono: ${esc(phone)}` : '',
};
const pendiente = [...new Set(falta)];
values.ROBOTS = pendiente.length ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow">';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(SRC, 'assets'), join(OUT, 'assets'), { recursive: true });

for (const f of readdirSync(SRC)) {
  if (!/\.(html|css)$/.test(f)) continue;
  let text = readFileSync(join(SRC, f), 'utf8');
  text = text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : (console.warn(`! Marcador sin valor: ${m} en ${f}`), m)));
  writeFileSync(join(OUT, f), text);
}
// El robots.txt solo deja pasar a los buscadores cuando los datos legales están completos.
writeFileSync(join(OUT, 'robots.txt'), pendiente.length ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n');

console.log(`✓ Web generada en ${OUT}`);
console.log(`  Log-in → ${appUrl}`);
console.log(`  Android → ${apkUrl || '(sin APK_URL: botón desactivado)'}`);
if (pendiente.length) {
  console.warn(`! Faltan datos legales (${pendiente.join(', ')}): se ve «[COMPLETAR…]» y la web queda sin indexar. Complétalos antes de publicar.`);
}
if (!existsSync(join(OUT, 'index.html'))) { console.error('✗ No se generó index.html'); process.exit(1); }

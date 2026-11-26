// Genera landing/dist (inglés en la raíz, /es/, /it/ y /de/) sustituyendo los datos que cambian de un despliegue a otro.
// Sin dependencias: solo Node. En Render: build `node build.mjs`, carpeta de salida `dist`.
//
// Variables de entorno (en Render › Environment):
//   APP_URL        Dirección de la app (obligatoria en Render): a ella lleva «Log-in».
//   APK_URL        Descarga del APK de Android. Si falta, el botón se enseña desactivado.
//   PRICE          Precio mensual de Premium en euros, solo el número (por defecto 4.99).
//   SITE_URL       Dirección pública de esta web (opcional): activa canonical, hreflang y sitemap.
//   OWNER_NAME, OWNER_ADDRESS, CONTACT_EMAIL, PHONE   Datos del Impressum (obligatorios para publicar).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { C, LANGS } from './src/content.mjs';
import { home, imprint, privacy, ICON } from './src/pages.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'src');
const OUT = join(root, 'dist');
const env = process.env;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const validUrl = (name, v) => { try { return new URL(v).toString(); } catch { return fail(`${name} no es una dirección válida: ${v}`); } };

if (!env.APP_URL && env.RENDER) fail('Falta APP_URL: sin ella el botón «Log-in» no llevaría a ninguna parte. Defínela en Render › Environment.');
const appUrl = env.APP_URL ? validUrl('APP_URL', env.APP_URL) : 'http://localhost:8799';
const apkUrl = env.APK_URL ? validUrl('APK_URL', env.APK_URL) : '';
const siteUrl = env.SITE_URL ? validUrl('SITE_URL', env.SITE_URL).replace(/\/+$/, '') : '';

const amount = Number(String(env.PRICE || '4.99').replace(/[^\d.,]/g, '').replace(',', '.'));
if (!Number.isFinite(amount) || amount <= 0) fail(`PRICE debe ser un número de euros, por ejemplo 4.99 (recibido: ${env.PRICE})`);
const price = (lang) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(amount);

const falta = [];
/** Dato legal: si falta, queda un aviso amarillo bien visible y la web no se indexa. */
const legal = (name, label) => {
  const v = (env[name] || '').trim();
  if (v) return esc(v).replace(/\n/g, '<br>');
  falta.push(name);
  return `<span class="todo">[${label}]</span>`;
};
const TODO = { en: ['FILL IN', 'name', 'address'], es: ['COMPLETAR', 'nombre', 'dirección'], it: ['DA COMPLETARE', 'nome', 'indirizzo'], de: ['AUSFÜLLEN', 'Name', 'Anschrift'] };
const contactRaw = (env.CONTACT_EMAIL || '').trim();
if (!contactRaw) falta.push('CONTACT_EMAIL');
const pendiente = () => [...new Set(falta)];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(SRC, 'assets'), join(OUT, 'assets'), { recursive: true });
cpSync(join(SRC, 'styles.css'), join(OUT, 'styles.css'));

// Primero los datos legales (rellenan `falta`), después se pintan las páginas.
const legalData = Object.fromEntries(LANGS.map((l) => [l.code, {
  ownerName: legal('OWNER_NAME', `${TODO[l.code][0]}: ${TODO[l.code][1]}`),
  ownerAddress: legal('OWNER_ADDRESS', `${TODO[l.code][0]}: ${TODO[l.code][2]}`),
}]));
const legalOk = pendiente().length === 0;

for (const l of LANGS) {
  const t = C[l.code];
  const androidBtn = apkUrl
    ? `<a class="btn btn-primary" href="${esc(apkUrl)}" download>${ICON.download}${esc(t.hero.android)}</a>`
    : `<span class="btn btn-primary" aria-disabled="true" role="link">${ICON.download}${esc(t.hero.androidSoon)}</span>`;
  const c = {
    lang: l.code, t, app: appUrl, androidBtn, price: price(l.code), year: new Date().getFullYear(), siteUrl, legalOk,
    contact: contactRaw || 'contact@example.com', phone: (env.PHONE || '').trim(), ...legalData[l.code],
  };
  const dir = join(OUT, l.prefix);
  mkdirSync(dir, { recursive: true });
  for (const [file, render] of [['index.html', home], ['impressum.html', imprint], ['privacy.html', privacy]]) writeFileSync(join(dir, file), render(c));
  for (const k of ['resumen', 'ian']) if (!existsSync(join(SRC, `assets/img/app-${k}-${l.code}.webp`))) fail(`Falta la captura app-${k}-${l.code}.webp`);
}

// Los buscadores solo entran cuando los datos legales están completos.
writeFileSync(join(OUT, 'robots.txt'), legalOk ? `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ''}` : 'User-agent: *\nDisallow: /\n');
if (legalOk && siteUrl) {
  writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${LANGS.map((l) => `  <url><loc>${siteUrl}/${l.prefix}</loc></url>`).join('\n')}\n</urlset>\n`);
}

const leftover = readFileSync(join(OUT, 'index.html'), 'utf8').match(/\{\{\w+\}\}/g);
if (leftover) fail(`Quedaron marcadores sin sustituir: ${leftover.join(', ')}`);

console.log(`✓ Web generada en ${OUT}  (${LANGS.map((l) => l.code).join(', ')})`);
console.log(`  Log-in  → ${appUrl}`);
console.log(`  Android → ${apkUrl || '(sin APK_URL: botón desactivado)'}`);
console.log(`  Premium → ${price('en')} / ${price('de')}`);
if (!legalOk) console.warn(`! Faltan datos legales (${pendiente().join(', ')}): se ve el aviso amarillo y la web queda sin indexar. Complétalos antes de publicar.`);

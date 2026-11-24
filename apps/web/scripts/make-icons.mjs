// Genera los iconos PNG (PWA / iOS) desde un SVG. Ejecuta: npm run icons -w @econsultor/web
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

// Marca: tres columnas que crecen (flujo de ahorro) y un punto de "hoy".
const mark = (pad) => {
  const s = 512 - pad * 2;
  const u = s / 100;
  const x0 = pad;
  const bar = (i, h, color) =>
    `<rect x="${x0 + (14 + i * 28) * u}" y="${pad + (88 - h) * u}" width="${20 * u}" height="${h * u}" rx="${10 * u}" fill="${color}"/>`;
  return `
    ${bar(0, 34, '#3987e5')}
    ${bar(1, 54, '#1baf7a')}
    ${bar(2, 76, '#9085e9')}
    <circle cx="${x0 + 84 * u}" cy="${pad + 6 * u}" r="${7 * u}" fill="#f0efec"/>`;
};

const icon = (pad, radius) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#23232a"/><stop offset="1" stop-color="#0d0d0f"/></linearGradient></defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  ${mark(pad)}
</svg>`;

const png = async (name, svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(new URL(name, out).pathname);

await png('icon-512.png', icon(110, 112), 512);
await png('icon-192.png', icon(110, 112), 192);
await png('maskable-512.png', icon(150, 0), 512); // zona segura mayor, sin esquinas redondeadas
await png('apple-touch-icon.png', icon(110, 0), 180); // iOS aplica sus propias esquinas

writeFileSync(new URL('favicon.svg', out), icon(110, 112));

const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><g fill="#fff"><rect x="14" y="52" width="16" height="30" rx="8"/><rect x="40" y="36" width="16" height="46" rx="8"/><rect x="66" y="14" width="16" height="68" rx="8"/></g></svg>`;
await sharp(Buffer.from(badge)).png().toFile(new URL('badge.png', out).pathname);
console.log('Iconos generados en public/icons');

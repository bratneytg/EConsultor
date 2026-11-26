import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CATEGORIES } from '@econsultor/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { de } from '../src/i18n/de.js';
import { en } from '../src/i18n/en.js';
import { it as itDict } from '../src/i18n/it.js';
import { runReminders } from '../src/modules/notifications/scheduler.js';
import { buildApp } from '../src/server.js';
import { FileStore } from '../src/store/file-store.js';

/* ── Cobertura: cada texto que genera el servidor existe en los tres idiomas ── */
const SRC = join(__dirname, '..', 'src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return f === 'i18n' ? [] : walk(p);
    return /\.ts$/.test(f) && !/\.d\.ts$/.test(f) ? [p] : [];
  });
const Q = `'(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"|\`(?:\\\\.|[^\`\\\\$])*\``;
const CALLS = [
  new RegExp(`(?<![\\w.$])(?:tr|tk|badRequest|unauthorized|forbidden|notFound|conflict|unprocessable|SheetError)\\(\\s*(${Q})`, 'g'),
  new RegExp(`new (?:SheetError)\\(\\s*(${Q})`, 'g'),
  new RegExp(`new AppError\\([^,]+,[^,]+,\\s*(${Q})`, 'g'),
];
const used = new Set<string>();
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const re of CALLS) for (const m of src.matchAll(re)) used.add(new Function(`return ${m[1]}`)() as string);
}
// Mensajes de validación de `shared`, categorías y los que llegan por una variable.
for (const k of [
  'No autenticado', 'Acción no permitida', 'Datos no válidos', 'Fecha inválida (YYYY-MM-DD)', 'Mes inválido (YYYY-MM)',
  'La categoría no corresponde al tipo', 'Mínimo 10 caracteres', 'Introduce un email válido', 'Indica code o recoveryCode',
  ...CATEGORIES.map((c) => c.label),
]) used.add(k);
// Fragmentos que solo existen como argumento de otra llamada o los gestiona el mismo código.
used.delete('');

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe.each([['en', en], ['it', itDict], ['de', de]] as const)('textos del servidor en %s', (lang, dict) => {
  it('están todos', () => {
    expect([...used].filter((k) => !(k in dict)), `faltan en ${lang}`).toEqual([]);
  });
  it('conservan los {marcadores}', () => {
    for (const [k, v] of Object.entries(dict)) {
      expect(vars(v), `${lang}: ${k}`).toEqual(vars(k));
      expect(v.trim().length).toBeGreaterThan(0);
    }
  });
});
it('los tres diccionarios tienen los mismos textos', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(itDict).sort());
  expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
});

/* ── Integración: el idioma de la petición decide el idioma de la respuesta ── */
let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), new FileStore({ file: null }));
});
afterAll(() => app.close());
const json = (r: LightMyRequestResponse) => r.json() as Record<string, any>;

async function cuenta() {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `id${Date.now()}${Math.random()}@example.com`, password: 'Xk9-mango-lluvia-77', displayName: 'Giulia' } });
  return { authorization: `Bearer ${json(res).accessToken}` };
}

describe('idioma de las respuestas', () => {
  it('los errores salen en el idioma pedido (y en español si no se pide ninguno)', async () => {
    const pedir = (lang?: string) => app.inject({ method: 'POST', url: '/api/auth/login', headers: lang ? { 'x-lang': lang } : {}, payload: { email: 'nadie@example.com', password: 'Xk9-mango-lluvia-77' } });
    expect(json(await pedir('en')).message).toBe('Incorrect username or password');
    expect(json(await pedir('it')).message).toBe('Utente o password errati');
    expect(json(await pedir('de')).message).toBe('Benutzername oder Passwort falsch');
    expect(json(await pedir()).message).toBe('Usuario o contraseña incorrectos');
    expect(json(await pedir('xx')).message).toBe('Usuario o contraseña incorrectos'); // idioma desconocido
  });

  it('los avisos de la importación salen traducidos', async () => {
    const h = await cuenta();
    const csv = 'Date;Description;Amount\n02/11/2026;LIDL;-12,30\n03/11/2026;REWE;-20,10\n';
    const pedir = async (lang: string) => json(await app.inject({ method: 'POST', url: '/api/import/preview', headers: { ...h, 'x-lang': lang }, payload: { kind: 'csv', content: csv + '99/99/9999;??;abc\n' } }));
    const es = await pedir('es');
    const en_ = await pedir('en');
    expect(es.warnings.join(' ')).toMatch(/línea ignorada/);
    expect(en_.warnings.join(' ')).toMatch(/line was ignored|lines were ignored/);
  });

  it('el 413 de demasiadas filas y los errores de archivo se traducen', async () => {
    const h = await cuenta();
    const res = await app.inject({ method: 'POST', url: '/api/import/preview', headers: { ...h, 'x-lang': 'de' }, payload: { kind: 'pdf', content: 'AAAA' } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(json(res).message).not.toMatch(/El archivo|No he/);
  });

  it('los consejos salen en el idioma pedido y se guardan por idioma', async () => {
    const h = await cuenta();
    const get = async (lang: string) => json(await app.inject({ method: 'GET', url: '/api/advice', headers: { ...h, 'x-lang': lang } }));
    const es = await get('es');
    const en_ = await get('en');
    const de_ = await get('de');
    expect(es.items[0].title).toBe('Empieza por registrar una semana');
    expect(en_.items[0].title).toBe('Start by logging one week');
    expect(de_.items[0].title).toBe('Beginne damit, eine Woche lang einzutragen');
  });

  it('el idioma elegido se guarda en la cuenta', async () => {
    const h = await cuenta();
    const res = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: h, payload: { language: 'it' } });
    expect(res.statusCode).toBe(200);
    expect(json(res).language).toBe('it');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: h });
    expect(json(me).language).toBe('it');
    const mal = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: h, payload: { language: 'fr' } });
    expect(mal.statusCode).toBe(400);
  });
});

describe('recordatorio en el idioma de la cuenta', () => {
  it('el aviso sale en el idioma del usuario', async () => {
    const mandados: Record<string, string> = {};
    for (const [id, lang] of [['a', 'en'], ['b', 'it'], ['c', 'de'], ['d', undefined]] as const) {
      const store = new FileStore({ file: null });
      await store.users.create({
        id, email: `${id}@b.com`, displayName: 'Ana García', plan: 'free', currency: 'EUR', timezone: 'Europe/Berlin', language: lang,
        reminderEnabled: true, reminderTime: '21:00', mfa: { enabled: false, recoveryHashes: [] }, failedLogins: 0, createdAt: '', updatedAt: '',
      });
      await store.push.upsert({ endpoint: `https://push.example/${id}`, userId: id, keys: { p256dh: 'x', auth: 'y' }, createdAt: '' });
      await runReminders(store, new Date('2026-11-20T20:05:00Z'), async (_s, payload) => void (mandados[id] = payload));
    }
    expect(JSON.parse(mandados.a!).title).toBe('How did your day go?');
    expect(JSON.parse(mandados.b!).title).toBe("Com'è andata la giornata?");
    expect(JSON.parse(mandados.c!).title).toBe('Wie war dein Tag?');
    expect(JSON.parse(mandados.d!).title).toBe('How did your day go?'); // sin idioma guardado, el predeterminado
  });
});

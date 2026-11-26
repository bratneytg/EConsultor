import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@econsultor/shared';
import { TEMAS } from '../content/ayuda';
import { de } from './de';
import { en } from './en';
import { it as itDict } from './it';

/** Todos los textos que la app marca para traducir (`t`, `tk`, `tx`) existen en inglés, italiano y alemán. */
const SRC = join(__dirname, '..');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return f === 'i18n' ? [] : walk(p);
    return /\.tsx?$/.test(f) && !/\.test\.|\.d\.ts$/.test(f) ? [p] : [];
  });

const CALL = /(?<![\w.$])(?:t|tk|tx)\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\$])*`)/g;
const used = new Set<string>();
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(CALL)) used.add(new Function(`return ${m[1]}`)() as string);
}

/** Textos que llegan por una variable (no se ven en el código como literal): etiquetas del servidor, categorías, temas… */
const dinamicos = [
  ...CATEGORIES.map((c) => c.label),
  ...TEMAS,
  'Excelente', 'Sólida', 'En construcción', 'Atención',
  'Ahorro', 'Gastos fijos', 'Estabilidad', 'Constancia',
  'Objetivo: ahorrar ≥ 20 % de lo que ingresas', 'Ideal: fijos por debajo del 50 % de tus ingresos',
  'Gastos parecidos de un mes a otro', 'Registrar al menos 20 días al mes',
];
for (const d of dinamicos) used.add(d);

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string) => (s.match(/<\/?b>/g) ?? []).sort();

describe.each([['en', en], ['it', itDict], ['de', de]] as const)('diccionario %s', (lang, dict) => {
  it('tiene todos los textos de la app', () => {
    const faltan = [...used].filter((k) => !(k in dict));
    expect(faltan, `faltan en ${lang}`).toEqual([]);
  });
  it('conserva los {marcadores} y las <b> de cada texto', () => {
    for (const [k, v] of Object.entries(dict)) {
      expect(vars(v), `${lang}: ${k}`).toEqual(vars(k));
      expect(tags(v), `${lang}: ${k}`).toEqual(tags(k));
      expect(v.trim().length, `${lang}: ${k}`).toBeGreaterThan(0);
    }
  });
  it('no guarda textos que la app ya no usa', () => {
    const sobran = Object.keys(dict).filter((k) => !used.has(k));
    expect(sobran, `sobran en ${lang}`).toEqual([]);
  });
});

it('el número de textos coincide en los tres idiomas', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(itDict).sort());
  expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
});

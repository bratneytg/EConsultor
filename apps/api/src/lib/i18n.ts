import { AsyncLocalStorage } from 'node:async_hooks';
import { LANGUAGES, type Lang } from '@econsultor/shared';
import { de } from '../i18n/de.js';
import { en } from '../i18n/en.js';
import { it } from '../i18n/it.js';

/**
 * Textos que genera el servidor (consejos, avisos, errores…). Igual que en la web: el texto en español es la clave,
 * `tr('Hola, {name}', { name })`; en/it/de se buscan en su diccionario y, si falta, sale el español (nunca una clave rota).
 * El idioma sale de la petición (cabecera `X-Lang`) y, fuera de una petición (recordatorios), de la cuenta.
 */
const DICT: Record<Lang, Record<string, string>> = { es: {}, en, it, de };
const als = new AsyncLocalStorage<{ lang: Lang }>();

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
/** Sin idioma indicado (herramientas, pruebas, otros clientes) se responde en español, el idioma original de los textos. */
export const curLang = (): Lang => als.getStore()?.lang ?? 'es';
/** Ejecuta `fn` (y todo lo asíncrono que lance) con ese idioma. */
export const runWithLang = <T>(lang: Lang, fn: () => T): T => als.run({ lang }, fn);

const LOCALES: Record<Lang, string> = { en: 'en-IE', es: 'es-ES', it: 'it-IT', de: 'de-DE' };
export const localeOf = (lang: Lang = curLang()): string => LOCALES[lang];
/** Nombre del idioma en español, para pedírselo a la IA. */
export const LANG_NAME_ES: Record<Lang, string> = { en: 'inglés', es: 'español', it: 'italiano', de: 'alemán' };

const fill = (s: string, params?: Record<string, string | number>): string =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;

export function trFor(lang: Lang, key: string, params?: Record<string, string | number>): string {
  return fill(lang === 'es' ? key : (DICT[lang][key] ?? key), params);
}
export const tr = (key: string, params?: Record<string, string | number>): string => trFor(curLang(), key, params);

/** Marca un texto para traducir más tarde (datos estáticos). */
export const tk = (key: string): string => key;

/** Minúsculas para meter un nombre dentro de una frase: en alemán los sustantivos van con mayúscula. */
export const lcName = (s: string): string => (curLang() === 'de' ? s : s.toLowerCase());

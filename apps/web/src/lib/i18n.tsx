import { DEFAULT_LANG, LANGUAGES, type Lang } from '@econsultor/shared';
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { it } from '../i18n/it';

/**
 * Traducciones. El texto original está en español y hace de clave: `t('Guardar')`.
 * - es → se devuelve tal cual; en/it/de → se busca en su diccionario (si falta, sale el español, nunca una clave rota).
 * - Variables: `t('Hola, {name}', { name })`.
 * Un test comprueba que cada `t('…')` del código existe en los tres diccionarios, con las mismas variables.
 */
const KEY = 'ec_lang';
const EXPLICIT = 'ec_lang_set';

export const LANG_NAMES: Record<Lang, string> = { en: 'English', es: 'Español', it: 'Italiano', de: 'Deutsch' };
const LOCALES: Record<Lang, string> = { en: 'en-IE', es: 'es-ES', it: 'it-IT', de: 'de-DE' };
const DICT: Record<Lang, Record<string, string>> = { es: {}, en, it, de };

function readStored(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if ((LANGUAGES as readonly string[]).includes(v ?? '')) return v as Lang;
  } catch { /* sin almacenamiento */ }
  return DEFAULT_LANG;
}

let current: Lang = readStored();
export const getLang = (): Lang => current;
/** Cambia el idioma sin React (pruebas y arranque). */
export const setLangNow = (l: Lang): void => { current = l; };
/** Configuración regional para `Intl` (fechas, números, moneda). */
export const locale = (): string => LOCALES[current];
/** ¿La persona eligió idioma a mano en este dispositivo? (así, al iniciar sesión, se respeta su elección). */
export const langChosenHere = (): boolean => { try { return localStorage.getItem(EXPLICIT) === '1'; } catch { return false; } };
export const clearLangChoice = (): void => { try { localStorage.removeItem(EXPLICIT); } catch { /* nada */ } };

export function t(key: string, params?: Record<string, string | number>): string {
  const s = current === 'es' ? key : (DICT[current][key] ?? key);
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Como `t()`, pero entiende `<b>…</b>` y devuelve JSX: para frases con una palabra resaltada, sin partirlas en trozos. */
export function tx(key: string, params?: Record<string, string | number>): ReactNode {
  const parts = t(key, params).split(/(<b>.*?<\/b>)/g);
  return <>{parts.map((p, i) => (p.startsWith('<b>') ? <b key={i}>{p.slice(3, -4)}</b> : p))}</>;
}

/** Marca un texto para traducir más tarde (datos estáticos): devuelve el mismo texto y `t()` lo traduce al mostrarlo. */
export const tk = (key: string): string => key;

/** Plural sencillo: `plural(n, 'un día', '{n} días')`; cada forma se traduce como clave aparte. */
export function plural(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n });
}

interface Ctx { lang: Lang; setLang: (l: Lang, explicit?: boolean) => void }
const I18nCtx = createContext<Ctx>({ lang: DEFAULT_LANG, setLang: () => {} });
export const useI18n = (): Ctx => useContext(I18nCtx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang, explicit = true) => {
    current = l;
    try { localStorage.setItem(KEY, l); if (explicit) localStorage.setItem(EXPLICIT, '1'); } catch { /* sin almacenamiento */ }
    document.documentElement.lang = l;
    setState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

/** Remonta lo de dentro al cambiar de idioma, para que todos los textos se vuelvan a calcular. */
export function LangBoundary({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  return <Fragment key={lang}>{children}</Fragment>;
}

import { CATEGORIES } from '@econsultor/shared';
import type { Config } from '../../config.js';
import { LANG_NAME_ES, curLang } from '../../lib/i18n.js';
import { scrub } from './ai.js';
import { merchantKey } from './merchant.js';
import { haystack } from './categorize.js';
import type { RawRow } from './types.js';

/**
 * Identifica con IA los comercios que las reglas no reconocen.
 *
 *  1. Se agrupan los movimientos por comercio (50 cargos de «Zum Hirschen» son una sola pregunta).
 *  2. Primera pasada: Claude clasifica con lo que sabe, sin buscar nada (rápida y barata). Casi todo lo que tiene
 *     un nombre que lo dice («Skiverleih», «Weinstube», «Kiosk») sale aquí.
 *  3. Segunda pasada, solo para lo que sigue sin saberse: Claude busca el comercio en internet y lo clasifica según
 *     lo que es de verdad. Es lenta (puede tardar minutos) y tiene un cupo diario por cuenta.
 *
 * Lo que sale del servidor son solo nombres de comercio saneados (sin IBAN, correos ni números largos) y, como
 * mucho, el importe de un cargo de ejemplo. Los pagos a personas (transferencias) no se envían nunca.
 */

export interface Identified {
  categoryId: string;
  /** Qué es el comercio, en pocas palabras y en el idioma de la persona. */
  hint: string;
  /** Se ha buscado en internet. */
  web: boolean;
}

export interface Merchant {
  /** Clave de agrupación (mismo comercio = misma clave). */
  key: string;
  /** Descripción saneada que se envía. */
  text: string;
  type: 'income' | 'expense';
  /** Importe medio en la moneda de la cuenta (solo orienta: un café no es un coche). */
  amount: number;
  count: number;
}

export interface Progress { stage: 'knowledge' | 'web'; done: number; total: number }

export interface IdentifyOptions {
  /** Permite buscar en internet. */
  web: boolean;
  /** Cuántos comercios se pueden buscar en internet hoy (cupo). Devuelve cuántos concede (0 = ninguno). */
  grantLookups: (wanted: number) => number;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

export interface IdentifyResult {
  found: Map<string, Identified>;
  /** Comercios que se habrían buscado en internet pero no había cupo o la búsqueda no está disponible. */
  skippedWeb: number;
  /** Comercios cuya búsqueda en internet se llegó a hacer (con o sin resultado). */
  webDone: number;
  /** Algún paso falló (clave inválida, sin crédito, búsqueda web desactivada…). */
  problem?: 'unavailable' | 'web_unavailable';
}

const TRANSFER = /(ueberweisung|dauerauftrag|sepa|transfer|bonifico|giroconto|traspaso|transferencia|rueckzahlung|zahlung an|pagamento a)/;
const CARD = /(kartenzahlung|girocard|\bvisa\b|mastercard|debit|\bpos\b|carta|tarjeta|presentment|lastschrift|paypal|sumup|zettle|apple pay|google pay)/;

/** Un pago a una persona o una transferencia privada: no se envía a ninguna IA ni se busca en internet. */
export function isPrivateTransfer(r: Pick<RawRow, 'name' | 'reference' | 'kind'>): boolean {
  const hay = haystack(r) + ' ' + String(r.kind ?? '').toLowerCase();
  return TRANSFER.test(hay) && !CARD.test(hay);
}

/** Agrupa los movimientos sin clasificar por comercio. `idx` guarda a qué filas corresponde cada grupo. */
export function groupMerchants(rows: { i: number; raw: RawRow }[]): { merchants: Merchant[]; idx: Map<string, number[]> } {
  const idx = new Map<string, number[]>();
  const byKey = new Map<string, Merchant & { sum: number }>();
  for (const { i, raw } of rows) {
    const text = scrub(haystack(raw)).slice(0, 90);
    if (text.length < 3) continue;
    const key = merchantKey(raw.name || raw.reference)?.key ?? text;
    const type = raw.amountMinor > 0 ? 'income' : 'expense';
    const k = `${type}:${key}`;
    const m = byKey.get(k) ?? { key: k, text, type, amount: 0, count: 0, sum: 0 };
    m.count += 1;
    m.sum += Math.abs(raw.amountMinor) / 100;
    byKey.set(k, m);
    idx.set(k, [...(idx.get(k) ?? []), i]);
  }
  const merchants = [...byKey.values()].map(({ sum, ...m }) => ({ ...m, amount: Math.round((sum / m.count) * 100) / 100 }));
  return { merchants, idx };
}

interface Block { type: string; text?: string; [k: string]: unknown }
type Raw = { ok: true; blocks: Block[]; stop: string } | { ok: false; status: number };

async function call(cfg: Config, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<Raw> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey ?? '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.anthropicModel, ...body }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json()) as { content?: Block[]; stop_reason?: string };
    return { ok: true, blocks: data.content ?? [], stop: data.stop_reason ?? 'end_turn' };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Lee el array JSON de la respuesta aunque venga con texto alrededor, con valla ``` o cortado a mitad. */
export function readArray(text: string): unknown[] {
  const a = text.indexOf('[');
  if (a < 0) return [];
  const b = text.lastIndexOf(']');
  if (b > a) {
    try { const v = JSON.parse(text.slice(a, b + 1)); if (Array.isArray(v)) return v; } catch { /* se rescata abajo */ }
  }
  // Cortado: se recuperan los objetos completos.
  const out: unknown[] = [];
  for (const m of text.slice(a).matchAll(/\{[^{}]*\}/g)) { try { out.push(JSON.parse(m[0])); } catch { /* objeto roto */ } }
  return out;
}

const CAT_LIST = CATEGORIES.map((c) => `${c.id} (${c.type === 'income' ? 'ingreso' : 'gasto'}: ${c.label})`).join('; ');
const lang = (): string => LANG_NAME_ES[curLang()];

const KNOWLEDGE_SYSTEM = () =>
  `Identificas comercios a partir de la descripción de un movimiento bancario de una persona que vive en Alemania (también aparecen Italia, España y otros países). Categorías: ${CAT_LIST}. ` +
  'Para cada comercio responde: k = la clave tal cual te la doy; c = categoría (SOLO de gasto si el tipo es gasto, SOLO de ingreso si es ingreso); ' +
  `d = qué es, en como máximo 6 palabras y en ${lang()} (p. ej. «Alquiler de esquís», «Bar de copas», «Papelería»); ` +
  's = seguridad: 2 = el propio nombre o tu conocimiento lo dicen claramente (Skiverleih, Weinstube, Kiosk, Flix…), 1 = es probable, 0 = no lo sabes. ' +
  'No inventes: si no lo sabes, s = 0 y c = other_expense (other_income si es ingreso). Los nombres de persona y las transferencias privadas son s = 0. ' +
  'Un importe pequeño y repetido orienta (café, kiosco); uno grande y único también (alquiler, viaje). ' +
  'Responde ÚNICAMENTE con un array JSON: [{"k":"…","c":"…","d":"…","s":2}].';

const WEB_SYSTEM = () =>
  `Identificas comercios a partir de la descripción de un movimiento bancario de una persona que vive en Alemania (también aparecen Italia, España y otros países). Categorías: ${CAT_LIST}. ` +
  'Busca en internet cada comercio (usa la ciudad o el país si aparecen en la descripción; si no, supón Alemania) y clasifícalo por lo que es de verdad. ' +
  'Para cada uno responde: k = la clave tal cual te la doy; c = categoría (SOLO de gasto si el tipo es gasto, SOLO de ingreso si es ingreso); ' +
  `d = qué es, en como máximo 6 palabras y en ${lang()}; s = 2 si lo has encontrado con claridad, 1 si es probable, 0 si no has encontrado nada fiable. ` +
  'No inventes ni mezcles comercios distintos con el mismo nombre: si dudas, s = 0 y c = other_expense (other_income si es ingreso). ' +
  'Cuando termines de buscar, responde ÚNICAMENTE con un array JSON: [{"k":"…","c":"…","d":"…","s":2}].';

const valid = new Map(CATEGORIES.map((c) => [c.id, c.type]));

interface Verdict { k: string; c: string; d: string; s: number }

function readVerdicts(text: string, asked: Merchant[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const byKey = new Map(asked.map((m) => [m.key, m]));
  for (const v of readArray(text)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const k = String(r.k ?? '');
    const m = byKey.get(k);
    const c = String(r.c ?? '');
    const s = Number(r.s);
    if (!m || !valid.has(c) || !Number.isFinite(s)) continue;
    if ((valid.get(c) === 'income') !== (m.type === 'income')) continue; // el tipo lo manda el signo del importe
    out.set(k, { k, c, d: String(r.d ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), s: Math.max(0, Math.min(2, Math.round(s))) });
  }
  return out;
}

const payload = (ms: Merchant[]): string => JSON.stringify(ms.map((m) => ({ k: m.key, t: m.text, tipo: m.type === 'income' ? 'ingreso' : 'gasto', importe_medio: m.amount, veces: m.count })));

/** Pregunta por un lote buscando en internet; continúa si la API pausa un turno largo. */
async function askWeb(cfg: Config, batch: Merchant[], signal?: AbortSignal): Promise<{ verdicts: Map<string, Verdict> } | { error: 'unavailable' | 'web_unavailable' }> {
  const messages: { role: string; content: unknown }[] = [{ role: 'user', content: payload(batch) }];
  for (let turn = 0; turn < 4; turn++) {
    const r = await call(cfg, {
      max_tokens: 1500,
      system: WEB_SYSTEM(),
      messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(8, batch.length * 2) }],
    }, 120_000, signal);
    if (!r.ok) return { error: r.status === 401 || r.status === 403 || r.status === 429 ? 'unavailable' : 'web_unavailable' };
    if (r.stop === 'pause_turn') { messages.push({ role: 'assistant', content: r.blocks }); continue; }
    const text = r.blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
    return { verdicts: readVerdicts(text, batch) };
  }
  return { verdicts: new Map() };
}

export async function identifyMerchants(cfg: Config, merchants: Merchant[], opts: IdentifyOptions): Promise<IdentifyResult> {
  const found = new Map<string, Identified>();
  const result: IdentifyResult = { found, skippedWeb: 0, webDone: 0 };
  if (!cfg.anthropicApiKey || merchants.length === 0) return result;

  // 1) Conocimiento del modelo, en lotes.
  const pending: Merchant[] = [];
  const BATCH = 50;
  for (let k = 0; k < merchants.length; k += BATCH) {
    if (opts.signal?.aborted) return result;
    const batch = merchants.slice(k, k + BATCH);
    opts.onProgress?.({ stage: 'knowledge', done: Math.min(k, merchants.length), total: merchants.length });
    const r = await call(cfg, { max_tokens: 4000, system: KNOWLEDGE_SYSTEM(), messages: [{ role: 'user', content: payload(batch) }] }, 90_000, opts.signal);
    if (!r.ok) {
      if (r.status === 401 || r.status === 403 || r.status === 429) result.problem = 'unavailable';
      pending.push(...batch);
      continue;
    }
    const verdicts = readVerdicts(r.blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'), batch);
    for (const m of batch) {
      const v = verdicts.get(m.key);
      if (v && v.s >= 1 && v.c !== 'other_expense' && v.c !== 'other_income') found.set(m.key, { categoryId: v.c, hint: v.d, web: false });
      else pending.push(m);
    }
  }
  opts.onProgress?.({ stage: 'knowledge', done: merchants.length, total: merchants.length });

  // 2) Búsqueda en internet para lo que sigue sin saberse (más importe y repetición primero: lo que más pesa en el análisis).
  if (!opts.web || pending.length === 0 || opts.signal?.aborted) return result;
  const ordered = [...pending].sort((a, b) => b.amount * b.count - a.amount * a.count);
  const granted = opts.grantLookups(ordered.length);
  result.skippedWeb = ordered.length - granted;
  const todo = ordered.slice(0, granted);
  if (todo.length === 0) return result;

  const WEB_BATCH = 4;
  const batches: Merchant[][] = [];
  for (let k = 0; k < todo.length; k += WEB_BATCH) batches.push(todo.slice(k, k + WEB_BATCH));
  let done = 0;
  opts.onProgress?.({ stage: 'web', done, total: todo.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < batches.length && !opts.signal?.aborted && result.problem !== 'web_unavailable') {
      const batch = batches[next++]!;
      const r = await askWeb(cfg, batch, opts.signal);
      if ('error' in r) {
        // Búsqueda no disponible (desactivada en la cuenta de IA, sin crédito…): se deja de insistir.
        result.problem = result.problem ?? r.error;
        result.skippedWeb += batch.length;
      } else {
        result.webDone += batch.length;
        for (const m of batch) {
          const v = r.verdicts.get(m.key);
          if (v && v.s >= 1 && v.c !== 'other_expense' && v.c !== 'other_income') found.set(m.key, { categoryId: v.c, hint: v.d, web: true });
        }
      }
      done += batch.length;
      opts.onProgress?.({ stage: 'web', done: Math.min(done, todo.length), total: todo.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return result;
}

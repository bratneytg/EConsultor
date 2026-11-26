import { randomUUID } from 'node:crypto';
import { userHasCategory, type CaptureInfo, type CaptureIgnored, type CaptureItem, type CaptureMode, type Transaction } from '@econsultor/shared';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { prefsOf } from '../../lib/categories.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { trFor } from '../../lib/i18n.js';
import type { Store, UserRecord } from '../../store/types.js';
import { clearAdviceCache } from '../advice/advisor.js';
import { groupMerchants, identifyMerchants } from '../import/identify.js';
import { matchAgainst } from '../import/accounts.js';
import { buildHistory, categorize } from '../import/categorize.js';
import { merchantKey } from '../import/merchant.js';
import { norm } from '../import/parse.js';
import { hashToken, newToken, TOKEN_PREFIX, tokenMatches } from './token.js';
import { parseLooseAmount, parseNotification } from './parse.js';
import type { CaptureState } from '../../store/types.js';

export const MAX_ITEMS = 100;
export const MAX_IGNORED = 30;
export const DAILY_CAP = 400;
const ITEM_TTL_DAYS = 30;
const IGNORED_TTL_DAYS = 7;
const DUP_WINDOW_MS = 10 * 60_000;
const AI_DAILY = 40;

export const captureInput = z.object({
  token: z.string().max(80).optional(),
  source: z.enum(['wallet', 'notification', 'sms', 'manual', 'other']).default('other'),
  /** Texto de la notificación o del SMS tal como llegó. */
  text: z.string().max(2000).optional(),
  title: z.string().max(300).optional(),
  app: z.string().max(120).optional(),
  /** Datos ya separados (Atajos de iPhone): importe como número o texto («12,5», «12.50 €»). */
  amount: z.union([z.number(), z.string().max(40)]).optional(),
  currency: z.string().max(8).optional(),
  merchant: z.string().max(120).optional(),
  card: z.string().max(60).optional(),
  type: z.enum(['income', 'expense']).optional(),
  at: z.union([z.string().max(40), z.number()]).optional(),
  /** Identificador que genera el móvil: si reintenta el envío, no se duplica. */
  id: z.string().max(80).optional(),
});
export type CaptureInput = z.infer<typeof captureInput>;
export type CaptureStatus = 'added' | 'pending' | 'duplicate' | 'ignored' | 'limit';

// ── Un solo cambio a la vez por cuenta: el almacén guarda el registro entero y dos avisos seguidos se pisarían. ──
const chains = new Map<string, Promise<unknown>>();
export function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  chains.set(userId, tail);
  void tail.then(() => { if (chains.get(userId) === tail) chains.delete(userId); });
  return next;
}

export const stateOf = (u: UserRecord): CaptureState => (u.capture ??= { mode: 'smart', items: [], ignored: [], recent: [] });

function prune(st: CaptureState, now: number): void {
  const old = (iso: string, days: number) => now - Date.parse(iso) > days * 86_400_000;
  st.items = st.items.filter((i) => !old(i.at, ITEM_TTL_DAYS));
  st.ignored = st.ignored.filter((i) => !old(i.at, IGNORED_TTL_DAYS));
  st.recent = st.recent.filter((r) => now - r.at < DUP_WINDOW_MS);
}

// ── Token ──
const byToken = new Map<string, string>();
export async function userForToken(store: Store, token: string): Promise<UserRecord | undefined> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20 || token.length > 80) return undefined;
  const hash = hashToken(token);
  const cached = byToken.get(hash);
  if (cached) {
    const u = await store.users.byId(cached);
    if (u && tokenMatches(u.capture?.tokenHash, token)) return u;
    byToken.delete(hash);
  }
  for (const u of await store.users.all()) {
    if (tokenMatches(u.capture?.tokenHash, token)) { byToken.set(hash, u.id); return u; }
  }
  return undefined;
}

export async function createToken(store: Store, userId: string): Promise<string> {
  return withLock(userId, async () => {
    const user = (await store.users.byId(userId))!;
    const st = stateOf(user);
    if (st.tokenHash) byToken.delete(st.tokenHash);
    const t = newToken();
    st.tokenHash = t.hash; st.tokenHint = t.hint; st.tokenCreatedAt = new Date().toISOString(); delete st.lastUsedAt;
    user.updatedAt = new Date().toISOString();
    await store.users.update(user);
    return t.token;
  });
}

export async function revokeToken(store: Store, userId: string): Promise<void> {
  await withLock(userId, async () => {
    const user = (await store.users.byId(userId))!;
    const st = stateOf(user);
    if (st.tokenHash) byToken.delete(st.tokenHash);
    delete st.tokenHash; delete st.tokenHint; delete st.tokenCreatedAt; delete st.lastUsedAt;
    await store.users.update(user);
  });
}

export function infoOf(cfg: Config, user: UserRecord): CaptureInfo {
  const st = stateOf(user);
  const origin = (cfg.publicOrigin ?? '').replace(/\/$/, '');
  return {
    enabled: !!st.tokenHash,
    ...(st.tokenHint ? { tokenHint: st.tokenHint } : {}),
    ...(st.tokenCreatedAt ? { tokenCreatedAt: st.tokenCreatedAt } : {}),
    ...(st.lastUsedAt ? { lastUsedAt: st.lastUsedAt } : {}),
    mode: st.mode,
    endpoint: `${origin}/api/capture/in`,
    items: [...st.items].sort((a, b) => b.at.localeCompare(a.at)),
    ignored: [...st.ignored].sort((a, b) => b.at.localeCompare(a.at)),
  };
}

// ── Lectura de lo que llega ──
const P2P = /(sent|gesendet|enviado|inviato|ueberweisung|transfer|bizum|envoy)/;

interface Resolved { type: 'income' | 'expense'; amountMinor: number; currency?: string; merchant: string; p2p: boolean }

function resolve(inp: CaptureInput): Resolved | 'no_amount' | 'no_cue' {
  const loose = inp.amount !== undefined ? parseLooseAmount(inp.amount) : null;
  const text = [inp.title, inp.text].filter(Boolean).join(' ');
  const p2p = P2P.test(norm(text));
  if (loose) {
    const merchant = (inp.merchant ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    let parsed: ReturnType<typeof parseNotification> | undefined;
    if (!merchant && text) parsed = parseNotification({ title: inp.title, text: inp.text, app: inp.app });
    const m = merchant || (typeof parsed === 'object' ? parsed.merchant : '');
    const type = inp.type ?? (loose.negative ? 'income' : typeof parsed === 'object' ? parsed.type : 'expense');
    return { type, amountMinor: loose.minor, currency: loose.currency ?? (inp.currency?.trim().toUpperCase() || undefined), merchant: m, p2p };
  }
  if (!text) return 'no_amount';
  const parsed = parseNotification({ title: inp.title, text: inp.text, app: inp.app });
  if (typeof parsed === 'string') return parsed;
  return { ...parsed, type: inp.type ?? parsed.type, merchant: inp.merchant?.trim() || parsed.merchant, currency: parsed.currency ?? (inp.currency?.trim().toUpperCase() || undefined), p2p };
}

const aiUsed = new Map<string, { day: string; n: number }>();
const aiLeft = (id: string, day: string): boolean => (aiUsed.get(id)?.day === day ? aiUsed.get(id)!.n : 0) < AI_DAILY;
const aiTick = (id: string, day: string): void => { const u = aiUsed.get(id); aiUsed.set(id, { day, n: (u?.day === day ? u.n : 0) + 1 }); };

const fingerprint = (type: string, minor: number, merchant: string): string => `${type}|${minor}|${merchantKey(merchant)?.key ?? ''}`;

function sanitizeText(inp: CaptureInput): string {
  return [inp.title, inp.text].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Texto que se guarda de un aviso no reconocido: sin números largos (IBAN, tarjetas, códigos). */
const redact = (s: string): string => s.replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}\b/g, '[IBAN]').replace(/\b\d{6,}\b/g, '[…]');

export interface IngestResult { status: CaptureStatus; item?: CaptureItem; tx?: Transaction }

export async function ingest(cfg: Config, store: Store, userId: string, inp: CaptureInput, opts: { test?: boolean; now?: Date } = {}): Promise<IngestResult> {
  const result = await withLock(userId, async (): Promise<IngestResult & { refine?: { itemId: string; merchant: string } }> => {
    const user = await store.users.byId(userId);
    if (!user) throw notFound();
    const st = stateOf(user);
    const now = opts.now ?? new Date();
    const nowMs = now.getTime();
    prune(st, nowMs);
    const today = todayIn(user.timezone, now);
    st.lastUsedAt = now.toISOString();
    if (st.day?.date !== today) st.day = { date: today, n: 0 };
    if (!opts.test && st.day.n >= DAILY_CAP) { await store.users.update(user); return { status: 'limit' }; }
    st.day.n++;

    const r = resolve(inp);
    if (typeof r === 'string') {
      const text = redact(sanitizeText(inp));
      if (text && !opts.test) {
        const ig: CaptureIgnored = { id: randomUUID(), at: now.toISOString(), text, reason: r, ...(inp.app ? { from: inp.app.slice(0, 80) } : {}) };
        st.ignored = [ig, ...st.ignored].slice(0, MAX_IGNORED);
      }
      await store.users.update(user);
      return { status: 'ignored' };
    }

    const type = r.type;
    const lang = user.language ?? 'en';
    const merchant = r.merchant || (type === 'income' ? trFor(lang, 'Ingreso') : trFor(lang, 'Pago con tarjeta'));
    const fp = fingerprint(type, r.amountMinor, r.merchant);
    const clientKey = inp.id ? `id:${inp.id}` : undefined;
    const clash = st.recent.find((x) => (clientKey && x.fp === clientKey) || (!opts.test && x.fp === fp));
    const txs = await store.transactions.list(userId);
    // Lo mismo ya guardado hoy (a mano o en una importación): mismo importe, tipo y nombre parecido.
    const sameDay = txs.filter((t) => t.date >= addDays(today, -1) && t.date <= addDays(today, 1));
    const known = opts.test ? undefined : matchAgainst([{ date: today, type, amountMinor: r.amountMinor, note: merchant }], sameDay, { tolDays: 1, names: !!r.merchant }).get(0);
    if (!opts.test && (clash || known)) {
      await store.users.update(user);
      return { status: 'duplicate' };
    }
    st.recent.push({ fp, at: nowMs });
    if (clientKey) st.recent.push({ fp: clientKey, at: nowMs });

    const currency = r.currency ?? user.currency;
    const foreign = currency !== user.currency;
    const signed = type === 'income' ? r.amountMinor : -r.amountMinor;
    const cat = categorize({ date: today, amountMinor: signed, name: merchant }, buildHistory(txs));
    const prefs = prefsOf(user);
    const categoryId = userHasCategory(prefs, cat.categoryId) ? cat.categoryId : type === 'income' ? 'other_income' : 'other_expense';
    const sure = cat.confidence === 'high' && !cat.internal;
    const auto = !opts.test && !foreign && (st.mode === 'auto' || (st.mode === 'smart' && sure));

    const source = inp.source;
    if (auto) {
      const iso = now.toISOString();
      const t: Transaction = { id: randomUUID(), type, amountMinor: r.amountMinor, currency: user.currency, categoryId, date: today, note: merchant.slice(0, 200), source: 'capture', createdAt: iso, updatedAt: iso };
      await store.transactions.create(userId, t);
      await store.users.update(user);
      clearAdviceCache(userId);
      return { status: 'added', tx: t };
    }
    const item: CaptureItem = {
      id: randomUUID(), at: now.toISOString(), type, amountMinor: r.amountMinor, currency, merchant: merchant.slice(0, 80), categoryId,
      confidence: cat.confidence, source, ...(inp.app ? { from: inp.app.slice(0, 80) } : {}), ...(cat.hint ? { hint: cat.hint } : {}), ...(foreign ? { foreign: true } : {}), ...(opts.test ? { test: true } : {}),
    };
    st.items = [item, ...st.items].slice(0, MAX_ITEMS);
    await store.users.update(user);
    const refine = !opts.test && !foreign && type === 'expense' && cat.confidence === 'low' && !r.p2p && !!r.merchant && !!cfg.anthropicApiKey && aiLeft(userId, today);
    return { status: 'pending', item, ...(refine ? { refine: { itemId: item.id, merchant: r.merchant } } : {}) };
  });
  if (result.refine) {
    const { itemId, merchant } = result.refine;
    void refineItem(cfg, store, userId, itemId, merchant).catch(() => undefined);
  }
  const { refine: _r, ...out } = result;
  return out;
}

/** Un pago pendiente sin categoría clara: se le pregunta a Claude qué es el comercio (sin buscar en internet) para proponerla. */
async function refineItem(cfg: Config, store: Store, userId: string, itemId: string, merchant: string): Promise<void> {
  const user = await store.users.byId(userId);
  if (!user) return;
  const today = todayIn(user.timezone);
  aiTick(userId, today);
  const item = stateOf(user).items.find((i) => i.id === itemId);
  if (!item) return;
  const { merchants } = groupMerchants([{ i: 0, raw: { date: today, amountMinor: -item.amountMinor, name: merchant } }]);
  const res = await identifyMerchants(cfg, merchants, { web: false, grantLookups: () => 0 });
  const found = [...res.found.values()][0];
  if (!found) return;
  await withLock(userId, async () => {
    const u = (await store.users.byId(userId))!;
    const it = stateOf(u).items.find((i) => i.id === itemId);
    if (!it || !userHasCategory(prefsOf(u), found.categoryId)) return;
    it.categoryId = found.categoryId; it.confidence = 'medium'; if (found.hint) it.hint = found.hint;
    await store.users.update(u);
  });
}

// ── Bandeja de entrada ──
export interface AcceptOverrides { categoryId?: string; merchant?: string; amountMinor?: number; date?: string }

export async function accept(store: Store, userId: string, itemId: string, o: AcceptOverrides = {}): Promise<Transaction | null> {
  return withLock(userId, async () => {
    const user = (await store.users.byId(userId))!;
    const st = stateOf(user);
    const item = st.items.find((i) => i.id === itemId);
    if (!item) throw notFound('Este pago ya no está pendiente.');
    if (item.test) { st.items = st.items.filter((i) => i.id !== itemId); await store.users.update(user); return null; }
    if (item.foreign && o.amountMinor === undefined) throw badRequest('Este pago está en otra moneda: escribe el importe en tu moneda para añadirlo.', 'foreign_amount');
    const categoryId = o.categoryId ?? item.categoryId;
    const cat = userHasCategory(prefsOf(user), categoryId);
    if (!cat) throw badRequest('Esa categoría no existe', 'unknown_category');
    if (cat.type !== item.type) throw badRequest('La categoría no corresponde al tipo', 'bad_category');
    const iso = new Date().toISOString();
    const t: Transaction = {
      id: randomUUID(), type: item.type, amountMinor: o.amountMinor ?? item.amountMinor, currency: user.currency, categoryId, date: o.date ?? todayIn(user.timezone, new Date(item.at)),
      note: (o.merchant ?? item.merchant).slice(0, 200), source: 'capture', createdAt: iso, updatedAt: iso,
    };
    await store.transactions.create(userId, t);
    st.items = st.items.filter((i) => i.id !== itemId);
    await store.users.update(user);
    clearAdviceCache(userId);
    return t;
  });
}

/** Añade todo lo pendiente salvo lo que está en otra moneda (hay que escribirle el importe) y lo de prueba. */
export async function acceptAll(store: Store, userId: string): Promise<{ added: number; left: number }> {
  const user = (await store.users.byId(userId))!;
  const ids = stateOf(user).items.filter((i) => !i.foreign && !i.test).map((i) => i.id);
  let added = 0;
  for (const id of ids) { try { if (await accept(store, userId, id)) added++; } catch { /* ya no estaba */ } }
  const left = stateOf((await store.users.byId(userId))!).items.length;
  return { added, left };
}

export async function discard(store: Store, userId: string, itemId: string | 'all'): Promise<void> {
  await withLock(userId, async () => {
    const user = (await store.users.byId(userId))!;
    const st = stateOf(user);
    st.items = itemId === 'all' ? [] : st.items.filter((i) => i.id !== itemId);
    await store.users.update(user);
  });
}

export async function clearIgnored(store: Store, userId: string, id: string | 'all'): Promise<void> {
  await withLock(userId, async () => {
    const user = (await store.users.byId(userId))!;
    const st = stateOf(user);
    st.ignored = id === 'all' ? [] : st.ignored.filter((i) => i.id !== id);
    await store.users.update(user);
  });
}

export async function setMode(store: Store, userId: string, mode: CaptureMode): Promise<void> {
  await withLock(userId, async () => {
    const user = (await store.users.byId(userId))!;
    stateOf(user).mode = mode;
    await store.users.update(user);
  });
}

export const _resetCapture = (): void => { chains.clear(); byToken.clear(); aiUsed.clear(); };

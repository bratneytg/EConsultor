import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { clearAdviceCache, getAdvice, getDetailedAdvice } from '../src/modules/advice/advisor.js';
import { generateDemoTransactions } from '../src/modules/demo/seed.js';

const TODAY = '2026-11-26';
const txs = generateDemoTransactions(TODAY, 7);
const cfg = (key?: string) => ({ anthropicApiKey: key, anthropicModel: 'claude-test' }) as Config;
const args = { userId: 'u1', plan: 'premium' as const, currency: 'EUR', today: TODAY, txs, refresh: true };

/** Simula la respuesta de la API de Anthropic. */
const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
const reply = (items: unknown) => respond(200, { content: [{ type: 'text', text: JSON.stringify(items) }] });

const item = (over: Record<string, unknown> = {}) => ({ kind: 'saving', severity: 'tip', title: 'Título del consejo', body: 'Un texto de consejo con suficiente longitud.', ...over });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearAdviceCache('u1'); });

describe('IA de los consejos: dice por qué no responde', () => {
  it('sin clave en el servidor: avisa con no_key y usa las reglas', async () => {
    const r = await getAdvice(cfg(), args);
    expect(r.source).toBe('rules');
    expect(r.aiIssue).toBe('no_key');
    const d = await getDetailedAdvice(cfg(), args);
    expect(d.aiIssue).toBe('no_key');
    expect(d.basis?.aiAvailable).toBe(false);
  });

  it('una cuenta gratis no ve avisos de IA', async () => {
    const r = await getAdvice(cfg(), { ...args, plan: 'free' as never });
    expect(r.aiIssue).toBeUndefined();
  });

  it.each([
    [401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'key'],
    [404, { error: { type: 'not_found_error', message: 'model: claude-test' } }, 'model'],
    [400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, 'limit'],
    [429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'limit'],
    [529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'busy'],
  ])('HTTP %i → %s', async (status, body, issue) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(status, body);
    const r = await getAdvice(cfg('sk-ant-x'), args);
    expect(r.source).toBe('rules');
    expect(r.aiIssue).toBe(issue);
  });

  it('no registra la clave en el log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(401, { error: { message: 'invalid x-api-key' } });
    await getAdvice(cfg('sk-ant-SECRETA'), args);
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRETA');
    expect(JSON.stringify(log.mock.calls)).toContain('key');
  });

  it('sin red: network', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await getAdvice(cfg('k'), args)).aiIssue).toBe('network');
  });

  it('una respuesta ilegible: format (y no se guarda en caché para reintentar)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(200, { content: [{ type: 'text', text: 'Lo siento, no puedo.' }] });
    const r = await getAdvice(cfg('k'), { ...args, refresh: false });
    expect(r.aiIssue).toBe('format');
    reply([item()]);
    const again = await getAdvice(cfg('k'), { ...args, refresh: false });
    expect(again.source).toBe('ai');
    expect(again.aiIssue).toBeUndefined();
  });

  it('con respuesta buena: source ai y sin aviso', async () => {
    reply([item(), item({ kind: 'win', severity: 'win', title: 'Buen mes' })]);
    const r = await getAdvice(cfg('k'), args);
    expect(r.source).toBe('ai');
    expect(r.aiIssue).toBeUndefined();
    expect(r.items[0]!.title).toBe('Título del consejo');
  });

  it('textos demasiado largos o importes con decimales se ajustan en vez de descartar la respuesta', async () => {
    reply([item({ title: 'T'.repeat(140), body: 'B'.repeat(900), impactMinor: 1234.56 })]);
    const r = await getAdvice(cfg('k'), args);
    expect(r.source).toBe('ai');
    const a = r.items[0]!;
    expect(a.title.length).toBeLessThanOrEqual(90);
    expect(a.body.length).toBeLessThanOrEqual(500);
    expect(a.impactMinor).toBe(1235);
  });

  it('análisis a fondo con IA: ok y fallo con motivo', async () => {
    const det = (n: number) => Array.from({ length: n }, () => item({ action: 'Pon un tope semanal de 40 € en restaurantes.' }));
    reply(det(4));
    const ok = await getDetailedAdvice(cfg('k'), { ...args, useAi: true });
    expect(ok.source).toBe('ai');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(401, { error: { message: 'invalid x-api-key' } });
    const bad = await getDetailedAdvice(cfg('k'), { ...args, useAi: true, refresh: true });
    expect(bad.source).toBe('rules');
    expect(bad.aiIssue).toBe('key');
  });
});

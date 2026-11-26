import type { Config } from '../../config.js';
import type { RawRow } from './types.js';

/** Quita lo más identificativo antes de enviar nada a un tercero: IBAN, correos y números largos. */
export function scrub(s: string): string {
  return s
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}\b/g, '[IBAN]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b\d{9,}\b/g, '[nº]')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ask(cfg: Config, system: string, user: string, maxTokens: number): Promise<string | null> {
  if (!cfg.anthropicApiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return data.content?.find((c) => c.type === 'text')?.text ?? null;
  } catch {
    return null;
  }
}

const json = (t: string): unknown => {
  const a = t.indexOf('[');
  const b = t.lastIndexOf(']');
  return a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null;
};

/** Extrae movimientos de un PDF difícil a partir de su texto. */
export async function aiExtractStatement(cfg: Config, text: string): Promise<RawRow[] | null> {
  const reply = await ask(
    cfg,
    'Extraes movimientos de un extracto bancario. Responde SOLO con un array JSON: [{"date":"YYYY-MM-DD","amount":-12.34,"name":"comercio o concepto"}]. ' +
      'amount: negativo para gastos/cargos, positivo para ingresos/abonos, en la moneda de la cuenta. Ignora saldos, totales y cabeceras. Fechas día-primero si son ambiguas.',
    scrub(text).slice(0, 60_000),
    8000,
  );
  if (!reply) return null;
  try {
    const arr = json(reply) as { date?: string; amount?: number; name?: string }[] | null;
    const rows: RawRow[] = [];
    for (const r of arr ?? []) {
      if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || typeof r.amount !== 'number' || !Number.isFinite(r.amount)) continue;
      const amountMinor = Math.round(r.amount * 100);
      if (amountMinor !== 0) rows.push({ date: r.date, amountMinor, name: String(r.name ?? '').slice(0, 120) });
    }
    return rows;
  } catch {
    return null;
  }
}

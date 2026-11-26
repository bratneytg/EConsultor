import type { AdviceKind, AdviceSeverity } from '@econsultor/shared';

/** Un consejo ya limpio, listo para convertirse en `Advice`. */
export interface ParsedAdvice {
  kind: AdviceKind;
  severity: AdviceSeverity;
  title: string;
  body: string;
  impactMinor?: number;
  action?: string;
}

const KINDS: readonly AdviceKind[] = ['saving', 'spending', 'income', 'habit', 'risk', 'win'];
const SEVERITIES: readonly AdviceSeverity[] = ['info', 'tip', 'warn', 'win'];

/** Sinónimos que a veces usa el modelo en lugar de los valores pedidos. */
const KIND_ALIAS: Record<string, AdviceKind> = {
  ahorro: 'saving', savings: 'saving', save: 'saving', gasto: 'spending', gastos: 'spending', expense: 'spending', expenses: 'spending',
  ingreso: 'income', ingresos: 'income', earn: 'income', habito: 'habit', hábito: 'habit', habits: 'habit',
  riesgo: 'risk', warning: 'risk', logro: 'win', success: 'win', achievement: 'win',
};
const SEVERITY_ALIAS: Record<string, AdviceSeverity> = {
  information: 'info', informacion: 'info', información: 'info', consejo: 'tip', suggestion: 'tip', medium: 'tip',
  warning: 'warn', alerta: 'warn', atencion: 'warn', atención: 'warn', high: 'warn', critical: 'warn',
  success: 'win', logro: 'win', good: 'win', low: 'info',
};

const norm = (v: unknown): string => String(v ?? '').toLowerCase().trim();
const pickKind = (v: unknown, fallback: AdviceKind): AdviceKind => {
  const s = norm(v);
  return (KINDS as readonly string[]).includes(s) ? (s as AdviceKind) : KIND_ALIAS[s] ?? fallback;
};
const pickSeverity = (v: unknown, fallback: AdviceSeverity): AdviceSeverity => {
  const s = norm(v);
  return (SEVERITIES as readonly string[]).includes(s) ? (s as AdviceSeverity) : SEVERITY_ALIAS[s] ?? fallback;
};

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Importe en céntimos: acepta números, «1234», «1.234,50» no (se descarta) y recorta lo absurdo. */
const minor = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_00) return undefined;
  return Math.round(n);
};

/** Convierte un objeto cualquiera del modelo en un consejo válido, o `null` si no sirve. */
function toAdvice(raw: unknown, detailed: boolean): ParsedAdvice | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = text(o.title ?? o.titulo ?? o.título ?? o.headline);
  const body = text(o.body ?? o.cuerpo ?? o.description ?? o.descripcion ?? o.descripción ?? o.text);
  if (title.length < 3 || body.length < 10) return null;
  const action = text(o.action ?? o.accion ?? o.acción);
  const impact = minor(o.impactMinor ?? o.impact_minor ?? o.impact);
  return {
    kind: pickKind(o.kind ?? o.type ?? o.tipo, detailed ? 'spending' : 'saving'),
    severity: pickSeverity(o.severity ?? o.severidad ?? o.level, 'tip'),
    title: clip(title, 90),
    body: clip(body, 500),
    ...(impact !== undefined ? { impactMinor: impact } : {}),
    ...(action.length >= 3 ? { action: clip(action, 320) } : {}),
  };
}

/** Recorta desde `ini` (un `[` o `{`) hasta su cierre, respetando cadenas. Devuelve `null` si no se cierra. */
function balanced(s: string, ini: number): string | null {
  const open = s[ini]!;
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  for (let i = ini; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(ini, i + 1);
  }
  return null;
}

/** Si la respuesta se cortó a mitad, rescata los objetos que sí están completos. */
function salvage(s: string, ini: number): unknown[] {
  const out: unknown[] = [];
  let i = s.indexOf('{', ini + 1);
  while (i >= 0) {
    const objeto = balanced(s, i);
    if (!objeto) break;
    try { out.push(JSON.parse(objeto)); } catch { /* se salta */ }
    i = s.indexOf('{', i + objeto.length);
  }
  return out;
}

const firstArray = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') for (const x of Object.values(v)) if (Array.isArray(x)) return x;
  return null;
};

/** Saca la lista de consejos de lo que responda el modelo: con vallas ```json, texto alrededor, un objeto envolvente o cortada. */
export function extractItems(raw: string): unknown[] | null {
  const s = raw.replace(/```(?:json)?/gi, '').trim();
  try { const a = firstArray(JSON.parse(s)); if (a) return a; } catch { /* sigue */ }
  for (let i = s.indexOf('['); i >= 0; i = s.indexOf('[', i + 1)) {
    const bloque = balanced(s, i);
    if (bloque) {
      try { const a = firstArray(JSON.parse(bloque)); if (a && a.some((x) => x && typeof x === 'object')) return a; } catch { /* siguiente */ }
    } else {
      const rescatados = salvage(s, i);
      if (rescatados.length) return rescatados;
    }
  }
  // Un objeto con la lista dentro, pero con texto alrededor.
  const llave = s.indexOf('{');
  if (llave >= 0) {
    const bloque = balanced(s, llave);
    if (bloque) { try { const a = firstArray(JSON.parse(bloque)); if (a) return a; } catch { /* nada */ } }
  }
  return null;
}

/** Lista final de consejos válidos (los que no sirven se descartan, no se rechaza toda la respuesta). */
export function parseAdviceList(raw: string, detailed: boolean): ParsedAdvice[] | null {
  const items = extractItems(raw);
  if (!items) return null;
  const ok = items.map((x) => toAdvice(x, detailed)).filter((x): x is ParsedAdvice => x !== null).slice(0, detailed ? 9 : 8);
  return ok.length ? ok : null;
}

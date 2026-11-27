import { norm } from '../import/parse.js';

/**
 * Lee el texto de una notificación de pago (banco, Google Wallet, SMS…) en alemán, español, inglés e italiano.
 * No hay dos bancos que escriban igual, así que se busca lo esencial: un importe con su moneda, un verbo que diga si es
 * un pago o un cobro y el comercio. Si falta algo seguro, devuelve `null` (no se inventa un movimiento).
 */

export interface ParsedPayment { type: 'income' | 'expense'; amountMinor: number; currency?: string; merchant: string }
export type ParseFailure = 'no_amount' | 'no_cue';

const SYMBOL: Record<string, string> = { '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '$': 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', chf: 'CHF', fr: 'CHF' };

/** «1.234,56», «1,234.56», «12,5», «12.50», «1 234,56» → céntimos. */
export function parseAmountMinor(raw: string): number | null {
  let s = raw.replace(/[\s'’]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  let int = s, frac = '';
  if (dec >= 0) {
    const tail = s.slice(dec + 1);
    // Un único separador seguido de 3 cifras es de miles («1.234»); con 1-2 cifras es decimal.
    const single = s.split(/[.,]/).length === 2;
    if (!(single && tail.length === 3)) { int = s.slice(0, dec); frac = tail; }
  }
  int = int.replace(/[.,]/g, '');
  if (frac.length > 2) return null;
  const v = Number(`${int || '0'}.${frac.padEnd(2, '0') || '00'}`);
  const minor = Math.round(v * 100);
  return Number.isFinite(minor) && minor > 0 && minor <= 10_000_000_000 ? minor : null;
}

// ── Verbos: quién paga a quién ──
const SPEND = /\b(bezahlt|ausgegeben|zahlungsvorgang|zahlung|kartenzahlung|abbuchung|abgebucht|lastschrift|belastet|belastung|kauf|einkauf|ueberweisung gesendet|gesendet|paid|spent|payment|purchase|charged|debit|debited|sent|withdrawal|withdrawn|card payment|you paid|compra|pago|cargo|cargado|has pagado|has gastado|adeudo|retirada|domiciliacion|recibo|transferencia enviada|pagamento|acquisto|addebito|addebitato|hai speso|hai pagato|prelievo|bonifico inviato)\b/;
const INCOME = /\b(erhalten|zurueckerhalten|erstattung|erstattet|eingegangen|gutschrift|gutgeschrieben|eingang|geldeingang|received|deposit|deposited|credited|refund|refunded|incoming|got paid|ingreso|ingresado|has recibido|abono|abonado|transferencia recibida|nomina|devolucion|reembolso|accredito|accreditato|hai ricevuto|bonifico ricevuto|stipendio|rimborso)\b/;
// Sustantivos sueltos («Zahlung», «Pago»): no deciden por sí solos si entra o sale dinero.
const WEAK_SPEND = /^(zahlung|zahlung|payment|pago|pagamento|cargo|kauf|compra|purchase|acquisto|einkauf|sent|gesendet)$/;
const REFUND = /\b(refund|refunded|erstattung|rueckerstattung|gutschrift|devolucion|reembolso|rimborso)\b/;
// No son un pago: códigos, avisos y saldos.
const NOISE = /\b(codigo|code|otp|tan|pin|passcode|sicherheitscode|verification|verifizierung|verifica|login|anmeldung|angebot|rabatt|gutschein|werbung|promo|promocion|offer|discount|newsletter|spare|sparen|save|ahorra|risparmia|sconto|oferta|descuento)\b/;
// Verbos de pago ya hecho: con uno de estos, un aviso con palabras de oferta sigue siendo un pago.
const STRONG = /\b(bezahlt|ausgegeben|abgebucht|belastet|kartenzahlung|paid|spent|charged|card payment|you paid|has pagado|has gastado|pagado|gastado|compra de|cargo de|hai speso|hai pagato|pagamento di|acquisto|addebito|gutschrift|erhalten|received|has recibido|hai ricevuto)\b/;
const BALANCE = /\b(saldo|balance|kontostand|verfuegbar|disponible|disponibile|available|limite|limit|restante|remaining|bleibt|rest)\b/;

const CUR = '(€|eur(?:os?)?|\\$|usd|£|gbp|chf)';
const NUM = "(\\d{1,3}(?:[.\\s'’]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const AMOUNT = new RegExp(`(?:([-−–+])\\s*)?(?:${CUR}\\s*${NUM}|${NUM}\\s*${CUR})`, 'i');

interface Found { minor: number; currency?: string; sign: string; index: number; length: number }

/** «Spent 7,80 at X»: algunos bancos no escriben la moneda; vale si un verbo de pago va pegado al número. */
const BARE = new RegExp(`\\b(?:spent|paid|payment of|pagado|pago de|gastado|speso|pagato|ausgegeben|bezahlt|received|recibido|ricevuto|erhalten)\\s+${NUM}(?![\\d.,]*\\s*%)`, 'i');

function findAmount(text: string): Found | null {
  // Frase a frase: un importe junto a «saldo / disponible» es el saldo, no el pago.
  let offset = 0;
  for (const part of text.split(/(?<=[.!?\n])\s+(?=[A-ZÄÖÜÁÉÍÓÚÀÈÌÒÙ¡¿0-9€$£])/)) {
    const idx = text.indexOf(part, offset);
    offset = idx + part.length;
    const m = AMOUNT.exec(part);
    if (!m) {
      const b = BARE.exec(norm(part));
      const minor = b ? parseAmountMinor(b[1]!) : null;
      if (b && minor !== null) return { minor, sign: '', index: idx + b.index + b[0].length, length: 0 };
      continue;
    }
    const before = norm(part.slice(Math.max(0, m.index - 28), m.index));
    if (BALANCE.test(before)) continue;
    const num = m[3] ?? m[4]!;
    const cur = (m[2] ?? m[5] ?? '').toLowerCase();
    const minor = parseAmountMinor(num);
    if (minor === null) continue;
    return { minor, currency: SYMBOL[cur], sign: m[1] ?? '', index: idx + m.index, length: m[0].length };
  }
  return null;
}

const GENERIC_TITLE = /^(?:\W*)(zahlung|payment|pago|pagamento|transaktion|transaction|transaccion|transazione|kartenzahlung|benachrichtigung|notification|notificacion|notifica|neue|new|nueva|nuovo|nuova|umsatz|bewegung|movimiento|movimento|aviso|info|hinweis|kauf|compra|purchase|acquisto|abbuchung|cargo|addebito|gutschrift|ingreso|accredito|you paid|has pagado|hai pagato|du hast)\b/i;

/** Quita lo que no es el nombre del comercio: tarjeta, ciudad tras coma, fecha, «mit Karte…». */
function cleanMerchant(s: string): string {
  return s
    .replace(/\s+(?:über|ueber|für|fuer|over|for|por|per)\s+[-−–+]?\s*[€$£\d].*$/i, '')
    .replace(/\b(?:mit|with|con|using|via|per|durch|tramite)\s+(?:der\s+|deiner\s+|tu\s+|tua\s+|your\s+|la\s+)?(?:karte|card|tarjeta|carta|girocard|visa|mastercard|apple pay|google pay|wallet)\b.*$/i, '')
    .replace(/\b(?:am|on|el|il|den|le)\s+\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b.*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s*[-−–+]?\s*\d[\d.,]*\s*(?:€|eur|usd|\$|£)\s*$/i, '')
    .replace(/[•*·]{2,}\s*\d{2,4}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s"'«„“:-]+|[\s"'»“”.,;:!?-]+$/g, '')
    .slice(0, 80)
    .trim();
}

/** Comercio: lo que sigue a «bei / en / at / presso…» tras el importe; si no, el título si parece un nombre. */
function findMerchant(title: string, text: string, from: number, app?: string): string {
  const body = text;
  const after = body.slice(from);
  const NAME = "((?:[^,.;:!?\\n]|\\.(?=[A-Za-z]))+)";
  const prep = new RegExp(`\\b(?:bei|von|an|im|in der|at|from|to|en|a favor de|de|presso|da|da parte di|su)\\s+${NAME}`, 'i');
  // Justo tras el importe también vale «a»: «Hai pagato 2,50 € a Caffè Roma».
  const m = new RegExp(`^\\s*(?:con\\s+\\S+\\s+)?a\\s+${NAME}`, 'i').exec(after) ?? prep.exec(after) ?? prep.exec(body);
  if (m) {
    const c = cleanMerchant(m[1]!.replace(/\s+(?:ausgegeben|bezahlt|gezahlt|gastado|pagado|speso|pagato|spent|paid|erhalten|zur(?:ue|ü)ckerhalten|recibido|ricevuto|received|abgebucht|cargado|addebitato|charged)\b.*$/i, ''));
    if (c.length >= 2 && !/^\d/.test(c)) return c;
  }
  // «Kartenzahlung -23,40 EUR DM Drogeriemarkt am 25.11.»: el nombre va pegado al importe.
  const glued = cleanMerchant(after.replace(/^\s*(?:eur(?:os?)?|usd|gbp|chf|[€$£])\b\s*/i, ''));
  if (glued.length >= 3 && glued.length <= 50 && /^[\p{L}]/u.test(glued) && !SPEND.test(norm(glued)) && !INCOME.test(norm(glued)) && !BALANCE.test(norm(glued)) && !NOISE.test(norm(glued))) return glued;
  // «Kartenzahlung: REWE Markt» / «Compra: REWE»
  const colon = /(?:zahlung|kauf|compra|pago|pagamento|acquisto|payment|purchase|abbuchung|lastschrift)\s*[:\-–]\s*((?:[^,;\n.]|\.(?=[A-Za-z])){2,70})/i.exec(body);
  if (colon) { const c = cleanMerchant(colon[1]!); if (c.length >= 2 && !/^\d/.test(c)) return c; }
  const t = cleanMerchant(title);
  const appName = norm(app ?? '');
  if (t && !/\d/.test(t) && t.length <= 40 && !GENERIC_TITLE.test(t) && (!appName || !norm(t).includes(appName.split(/[.\s]/).pop() ?? '#'))) return t;
  return '';
}

export interface NotificationInput { title?: string; text?: string; app?: string }

/** Notificaciones de una cartera (Google Wallet, Samsung Pay): aunque no digan «pagado», son pagos con tarjeta. */
const WALLET_APP = /wallet|samsung\.android\.spay|googlepay|gpay|apple/i;

function parseWallet(title: string, whole: string, a: Found): ParsedPayment {
  const merchant = findMerchant(title, whole, a.index + a.length);
  return { type: 'expense', amountMinor: a.minor, currency: a.currency, merchant };
}

export function parseNotification(inp: NotificationInput): ParsedPayment | ParseFailure {
  const implicit = inp.app && WALLET_APP.test(inp.app) ? 'spend' : undefined;
  const title = (inp.title ?? '').replace(/\s+/g, ' ').trim();
  const text = (inp.text ?? '').replace(/\s+/g, ' ').trim();
  const whole = [title, text].filter(Boolean).join('. ');
  const amount = findAmount(whole);
  if (!amount) return 'no_amount';
  const n = norm(whole);
  const spend = SPEND.exec(n);
  const inc = INCOME.exec(n);
  // Códigos de seguridad y publicidad no son pagos, aunque nombren una «Zahlung» o un «Einkauf».
  if (NOISE.test(n) && (/\b\d{4,8}\b/.test(n.replace(/\d+[.,]\d{1,2}/g, '')) || !STRONG.test(n))) return 'no_cue';
  if (!spend && !inc) {
    if (implicit === 'spend') return parseWallet(title, whole, amount);
    // Un importe con signo explícito y sin más palabras («REWE» / «−12,50 €») es un cargo o un abono.
    if (amount.sign && !NOISE.test(n)) {
      const merchant = findMerchant(title, whole, amount.index + amount.length, inp.app);
      return { type: amount.sign === '+' ? 'income' : 'expense', amountMinor: amount.minor, currency: amount.currency, merchant };
    }
    return 'no_cue';
  }
  // Si salen los dos, manda el que aparece primero («has recibido una devolución de tu pago»).
  let type: 'income' | 'expense' = inc && (!spend || inc.index < spend.index || WEAK_SPEND.test(spend[0])) ? 'income' : 'expense';
  if (amount.sign === '+') type = 'income';
  else if ((amount.sign === '-' || amount.sign === '−' || amount.sign === '–') && !REFUND.test(n)) type = 'expense';
  if (REFUND.test(n)) type = 'income';
  const merchant = findMerchant(title, whole, amount.index + amount.length, inp.app);
  return { type, amountMinor: amount.minor, currency: amount.currency, merchant };
}

/** Amount que llega ya separado (Atajos de iPhone: «12,5», «12.50 €», 12.5). */
export function parseLooseAmount(v: unknown): { minor: number; currency?: string; negative: boolean } | null {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0 ? { minor: Math.round(Math.abs(v) * 100), negative: v < 0 } : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const neg = /^[-−–]/.test(s);
  const cur = /(€|eur|usd|\$|£|gbp|chf)/i.exec(s)?.[1]?.toLowerCase();
  const num = /\d[\d.,\s'’]*/.exec(s)?.[0]?.trim();
  const minor = num ? parseAmountMinor(num) : null;
  return minor ? { minor, currency: cur ? SYMBOL[cur] : undefined, negative: neg } : null;
}

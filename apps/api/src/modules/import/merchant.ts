import { norm } from './parse.js';

const STOP = new Set([
  'kartenzahlung', 'kartenzahl', 'lastschrift', 'girocard', 'visa', 'mastercard', 'debit', 'card', 'payment', 'zahlung', 'ueberweisung', 'dauerauftrag',
  'sepa', 'pos', 'sumup', 'paypal', 'zettle', 'sq', 'markt', 'filiale', 'sb', 'gmbh', 'ag', 'kg', 'co', 'ek', 'ev', 'und', 'the', 'de', 'la', 'el',
  'der', 'die', 'das', 'bei', 'von', 'fuer', 'sagt', 'danke', 'vielen', 'dank', 'online', 'www', 'com', 'an', 'zu', 'im', 'in', 'am', 'herr', 'frau',
  'ihr', 'einkauf', 'europe', 'sarl', 'sca', 'et', 'cie', 'compra', 'tarjeta', 'pago', 'recibo',
]);

/** Clave estable de comercio a partir del nombre o la nota («REWE SAGT DANKE 4711 · Berlin» → «rewe»). */
export function merchantKey(note: string | undefined): { key: string; label: string } | null {
  if (!note) return null;
  const first = note.split('·')[0] ?? '';
  const tokens = norm(first).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
  if (tokens.length === 0) return null;
  const key = tokens[0]!;
  const lab = key.length <= 3 && tokens[1] ? `${key} ${tokens[1]}` : key;
  return { key, label: lab.charAt(0).toUpperCase() + lab.slice(1) };
}

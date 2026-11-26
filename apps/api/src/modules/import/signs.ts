import { polarity } from './categorize.js';
import { norm } from './parse.js';
import type { RawRow } from './types.js';

/**
 * Extractos de tarjeta (Nexi, Visa, Mastercard…): lo que gastas sale en positivo y las devoluciones o el pago de
 * la tarjeta, en negativo (o con «CR»). Es lo contrario de una cuenta corriente.
 */
const CARD_DOC = /(nexi|carta di credito|carta (visa|mastercard|oro|platinum|revolving)|estratto conto (della )?carta|rendiconto carta|lista movimenti carta|kreditkartenabrechnung|abrechnung (ihrer )?kreditkarte|kreditkarte|credit card statement|tarjeta de credito|extracto de (la )?tarjeta|relevé de carte|carte de credit|saldo carta|plafond)/;

export interface SignResolution {
  rows: RawRow[];
  mode: 'normal' | 'inverted' | 'unsigned';
  warnings: string[];
}

const flip = (r: RawRow): RawRow => ({ ...r, amountMinor: -r.amountMinor });

/**
 * Deja todos los importes con la convención «gasto < 0, ingreso > 0».
 *
 * - Importes con signo normal (lo habitual en cuentas): se respetan.
 * - Extractos de tarjeta o de signo invertido (los gastos en positivo): se detectan por el tipo de documento o
 *   porque las descripciones son de comercios y no de nóminas; se invierte el signo.
 * - Extractos sin ningún signo (todo positivo): cada línea se decide por su descripción; por defecto es un gasto,
 *   y solo es ingreso lo que lo dice (nómina, abono, devolución, el pago de la tarjeta…).
 */
export function resolveSigns(rows: RawRow[], docText: string, opts: { flip?: boolean } = {}): SignResolution {
  const warnings: string[] = [];
  const pos = rows.filter((r) => r.amountMinor > 0).length;
  const neg = rows.length - pos;
  const card = CARD_DOC.test(norm(docText));
  let out = rows;
  let mode: SignResolution['mode'] = 'normal';

  if (pos > 0 && neg === 0) {
    // Sin ningún signo negativo: no sirve para distinguir. Manda la descripción (y la columna «tipo» si la hay).
    mode = 'unsigned';
    out = rows.map((r) => {
      const income = r.hint ? r.hint === 'credit' : polarity(r) === 1;
      return income ? r : flip(r);
    });
    const incomes = out.filter((r) => r.amountMinor > 0).length;
    warnings.push(
      `${card ? 'Este extracto parece de una tarjeta de crédito, que lista los gastos en positivo. ' : 'El extracto no marca con signo los gastos y los ingresos. '}` +
        `He tratado cada línea como un gasto, salvo ${incomes === 1 ? '1 que parece' : `${incomes} que parecen`} un ingreso (nómina, abono o devolución). Revisa los ingresos; si todo está al revés, usa «Invertir gastos e ingresos».`,
    );
  } else if (pos > 0 && neg > 0) {
    let agree = 0;
    let disagree = 0;
    for (const r of rows) {
      const p = polarity(r);
      if (!p) continue;
      if (Math.sign(r.amountMinor) === p) agree++;
      else disagree++;
    }
    const inverted = (card && pos > neg) || (disagree >= 5 && disagree > 2 * agree);
    if (inverted) {
      mode = 'inverted';
      out = rows.map(flip);
      warnings.push('En este extracto los gastos van en positivo (es lo habitual en tarjetas de crédito). Los he contado como gastos, y los importes en negativo (devoluciones o pagos de la tarjeta), como ingresos.');
    }
  }

  if (opts.flip) {
    out = out.map(flip);
    warnings.push('Has invertido gastos e ingresos.');
  }
  return { rows: out, mode, warnings };
}

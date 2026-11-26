import { randomUUID } from 'node:crypto';
import { categoryById } from '@econsultor/shared';
import type { Config } from '../../config.js';
import { badRequest, AppError } from '../../lib/errors.js';
import { addDays } from '../../lib/dates.js';
import type { Store, UserRecord } from '../../store/types.js';
import { aiCategorize, aiExtractStatement } from './ai.js';
import { buildHistory, categorize, haystack } from './categorize.js';
import { rowsFromCsv } from './csv.js';
import { pdfLines, rowsFromPdfLines } from './pdf.js';
import { ocrPdfLines } from './ocr.js';
import { readSpreadsheet, SheetError } from './sheet.js';
import { resolveSigns } from './signs.js';
import { rowsFromTable } from './table.js';
import { isSameStatement, matchAgainst, normAccount, sameAccount, TRANSFER_CUE, windowAround, type Candidate, type Overlap } from './accounts.js';
import { norm } from './parse.js';
import type { ImportPreview, ImportRow, RawRow } from './types.js';
import { tr } from '../../lib/i18n.js';

export const MAX_ROWS = 5000;

export interface AnalyzeInput {
  kind: 'csv' | 'pdf' | 'sheet';
  /** CSV: texto. PDF y hoja de cálculo (.xlsx/.ods): contenido en base64. */
  content: string;
  useAi: boolean;
  /** La persona pide invertir gastos e ingresos (cuando el extracto tiene el signo al revés). */
  flipSigns?: boolean;
  /** Cuenta o tarjeta a la que pertenece el extracto (vacío = la principal). */
  account?: string;
  /** La persona confirma que es OTRA cuenta aunque se parezca a una que ya tiene. */
  assumeDifferentAccount?: boolean;
}

const unprocessable = (m: string, code = 'unreadable_statement') => new AppError(422, code, m);

function note(r: RawRow): string {
  const name = (r.name ?? '').replace(/\s+/g, ' ').trim();
  const ref = (r.reference ?? '').replace(/\s+/g, ' ').trim();
  const text = name && ref && !ref.toLowerCase().includes(name.toLowerCase()) ? `${name} · ${ref}` : name || ref;
  return text.replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}\b/g, '').trim().slice(0, 200);
}

/** Lee el extracto, categoriza (reglas; IA opcional) y marca duplicados frente a lo que el usuario ya tiene. */
export async function analyzeStatement(cfg: Config, store: Store, user: UserRecord, today: string, input: AnalyzeInput): Promise<ImportPreview> {
  const warnings: string[] = [];
  let engine: 'offline' | 'ai' = 'offline';
  let raw: RawRow[] = [];
  let docText = '';

  if (input.kind === 'csv') {
    try {
      const r = rowsFromCsv(input.content);
      raw = r.rows;
      docText = r.docText;
      warnings.push(...r.warnings);
    } catch (e) {
      throw unprocessable((e as Error).message);
    }
  } else if (input.kind === 'sheet') {
    const data = Buffer.from(input.content, 'base64');
    let tried = '';
    try {
      const sheets = readSpreadsheet(new Uint8Array(data));
      for (const sh of sheets) {
        try {
          const r = rowsFromTable(sh.rows, sh.name);
          if (r.rows.length) { raw = r.rows; docText = r.docText; warnings.push(...r.warnings); break; }
        } catch (e) {
          tried ||= (e as Error).message;
        }
      }
    } catch (e) {
      if (e instanceof SheetError) throw unprocessable(e.message, 'unreadable_sheet');
      throw e;
    }
    if (!raw.length) throw unprocessable(tried || tr('No he encontrado movimientos en ninguna hoja del archivo.'));
  } else {
    const data = Buffer.from(input.content, 'base64');
    if (data.length < 100 || data.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest(tr('El archivo no parece un PDF válido'));
    let lines: string[] = [];
    try {
      lines = await pdfLines(new Uint8Array(data));
    } catch {
      throw unprocessable(tr('No he podido abrir el PDF (¿está protegido con contraseña o dañado?). Prueba con el CSV.'));
    }
    const year = Number(today.slice(0, 4));
    let ocr = false;
    let r = rowsFromPdfLines(lines, year);
    if (r.rows.length === 0) {
      // Sin movimientos en el texto (PDF de imágenes: extracto escaneado o capturas, a veces con un «1/5» por página):
      // se lee con OCR si el servidor lo tiene.
      const o = await ocrPdfLines(new Uint8Array(data));
      if (o && o.length) {
        const ro = rowsFromPdfLines(o, year);
        if (ro.rows.length) { lines = o; r = ro; ocr = true; }
      }
    }
    if (lines.length === 0 || (r.rows.length === 0 && lines.every((l) => l.length < 10))) {
      throw unprocessable('Este PDF no tiene texto (parece una imagen escaneada). Descarga el CSV desde la web del banco; con N26: web app → descargar → CSV.', 'scanned_pdf');
    }
    raw = r.rows;
    docText = r.docText;
    warnings.push(...r.warnings);
    if (ocr) warnings.push(tr('Este PDF era una imagen: lo he leído con OCR. Revisa fechas, importes y signos antes de importar.'));
    if (raw.length < 3 && input.useAi && cfg.anthropicApiKey) {
      const ai = await aiExtractStatement(cfg, lines.join('\n'));
      if (ai && ai.length > raw.length) { raw = ai; engine = 'ai'; warnings.length = 0; docText = lines.slice(0, 60).join(' '); }
    }
    if (raw.length === 0) {
      throw unprocessable(cfg.anthropicApiKey ? tr('No he encontrado movimientos en este PDF: su formato no es el habitual. Prueba con el CSV o activa «Mejorar con IA».') : tr('No he encontrado movimientos en este PDF: su formato no es el habitual. Prueba con el CSV.'));
    }
  }

  // Qué es gasto y qué es ingreso: cada banco usa su convención (las tarjetas, p. ej., ponen los gastos en positivo).
  const resolved = resolveSigns(raw, docText, { flip: input.flipSigns });
  raw = resolved.rows;
  warnings.push(...resolved.warnings);

  // Saneado: fechas razonables, importes distintos de cero y tope de filas.
  const maxDate = addDays(today, 1);
  const before = raw.length;
  raw = raw.filter((r) => r.date >= '2000-01-01' && r.date <= maxDate && r.amountMinor !== 0);
  if (raw.length < before) warnings.push(tr('{n} movimientos con fecha futura o anterior al año 2000 se han descartado.', { n: before - raw.length }));
  if (raw.length === 0) throw unprocessable(tr('No hay movimientos válidos en el archivo.'));
  if (raw.length > MAX_ROWS) throw new AppError(413, 'too_many_rows', tr('El archivo tiene {n} movimientos; el máximo por importación es {max}. Divide el extracto por años.', { n: raw.length, max: MAX_ROWS }));

  // Categorización: reglas offline, luego lo que la propia persona ya categorizó para ese comercio
  // y, si lo pide, IA para lo que sigue sin reconocerse.
  const allTxs = await store.transactions.list(user.id, { limit: 50_000 });
  const history = buildHistory(allTxs);
  const cats = raw.map((r) => categorize(r, history));
  const learned = cats.filter((c) => c.via === 'history').length;
  if (learned) warnings.push(learned === 1 ? tr('1 movimiento se ha clasificado según lo que ya habías categorizado antes.') : tr('{n} movimientos se han clasificado según lo que ya habías categorizado antes.', { n: learned }));
  if (input.useAi && cfg.anthropicApiKey) {
    const unknown = cats.map((c, i) => ({ c, i })).filter(({ c }) => c.confidence === 'low');
    if (unknown.length) {
      const res = await aiCategorize(cfg, unknown.map(({ i }) => ({ i, text: haystack(raw[i]!), amountMinor: raw[i]!.amountMinor })));
      if (res.size) engine = 'ai';
      for (const [i, id] of res) cats[i] = { ...cats[i]!, categoryId: id, confidence: 'medium', via: 'ai' as const };
    }
  }

  // Duplicados y cuentas. Dentro de la MISMA cuenta, lo ya guardado (fecha, importe y tipo) sale desmarcado. Si casi todo
  // coincide con OTRA cuenta (mismo importe, fecha cercana y comercio parecido) es casi seguro el mismo extracto subido
  // con otro nombre: se avisa y se desmarca, salvo que la persona confirme que es otra cuenta.
  const account = normAccount(input.account);
  const dates = raw.map((r) => r.date).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const win = windowAround(from, to);
  const pool = allTxs.filter((t) => t.date >= win.from && t.date <= win.to);
  const sameAcc = pool.filter((t) => sameAccount(t.account, account));
  const others = pool.filter((t) => !sameAccount(t.account, account));

  const items: (Candidate & { internal: boolean })[] = raw.map((r, i) => {
    const c = cats[i]!;
    return {
      date: r.date,
      type: categoryById(c.categoryId)?.type ?? (r.amountMinor > 0 ? 'income' : 'expense'),
      amountMinor: Math.abs(r.amountMinor),
      note: note(r),
      internal: c.internal,
    };
  });
  const dupSame = matchAgainst(items, sameAcc, { tolDays: 0, names: false });
  const dupOther = matchAgainst(items, others, { tolDays: 2, names: true, skip: new Set(dupSame.keys()) });
  const sameStatement = isSameStatement(dupSame.size, items.length);
  let overlap: Overlap | null = null;
  if (!sameStatement && isSameStatement(dupOther.size, items.length)) {
    const counts = new Map<string, number>();
    for (const t of dupOther.values()) counts.set(t.account ?? '', (counts.get(t.account ?? '') ?? 0) + 1);
    const [acc] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    overlap = { account: acc, matched: dupOther.size, total: items.length };
  }
  const crossDuplicates = overlap && !input.assumeDifferentAccount;
  // Traspasos entre cuentas propias: mismo importe y signo contrario en otra cuenta, y el texto lo dice.
  const transfers = matchAgainst(items, others, { tolDays: 3, names: false, opposite: true, skip: new Set([...dupSame.keys(), ...dupOther.keys()]) });

  const rows: ImportRow[] = raw.map((r, i) => {
    const c = cats[i]!;
    const it = items[i]!;
    const row: ImportRow = { id: randomUUID(), date: r.date, type: it.type, categoryId: c.categoryId, amountMinor: it.amountMinor, note: it.note, confidence: c.confidence, via: c.via };
    if (dupSame.has(i)) row.skip = 'duplicate';
    else if (crossDuplicates && dupOther.has(i)) row.skip = 'other_account';
    else if (c.internal) row.skip = 'internal';
    else if (transfers.has(i) && TRANSFER_CUE.test(norm(`${r.name ?? ''} ${r.reference ?? ''}`))) row.skip = 'internal';
    return row;
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));

  const kept = rows.filter((r) => !r.skip);
  const sum = (t: 'income' | 'expense') => kept.filter((r) => r.type === t).reduce((s, r) => s + r.amountMinor, 0);
  const skipped = rows.length - kept.length;
  if (skipped) warnings.push(skipped === 1 ? tr('Hay 1 movimiento desmarcado: duplicado de lo que ya tienes o traspaso entre tus propias cuentas. Márcalo si lo quieres importar.') : tr('Hay {n} movimientos desmarcados: duplicados de lo que ya tienes o traspasos entre tus propias cuentas. Márcalos si los quieres importar.', { n: skipped }));
  const lowCount = kept.filter((r) => r.confidence === 'low').length;
  if (lowCount) warnings.push(lowCount === 1 ? tr('No he sabido clasificar con seguridad 1 movimiento: está como «Otros» y resaltado. Cambia su categoría antes de importar.') : tr('No he sabido clasificar con seguridad {n} movimientos: están como «Otros» y resaltados. Cambia su categoría antes de importar.', { n: lowCount }));

  return {
    source: input.kind,
    engine,
    rows,
    warnings,
    signs: { mode: resolved.mode, flipped: !!input.flipSigns },
    account,
    accounts: accountList(allTxs),
    ...(sameStatement ? { sameStatement: { matched: dupSame.size, total: items.length } } : {}),
    ...(overlap ? { overlap: { ...overlap, ignored: !!input.assumeDifferentAccount } } : {}),
    stats: { total: rows.length, income: kept.filter((r) => r.type === 'income').length, expense: kept.filter((r) => r.type === 'expense').length, skipped, from, to, incomeMinor: sum('income'), expenseMinor: sum('expense') },
  };
}

/** Cuentas que la persona ya usa, con su número de movimientos (la principal es la cadena vacía). */
export function accountList(txs: { account?: string }[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of txs) {
    const key = normAccount(t.account);
    const canon = [...m.keys()].find((k) => k.toLowerCase() === key.toLowerCase()) ?? key;
    m.set(canon, (m.get(canon) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

import { randomUUID } from 'node:crypto';
import { categoryById } from '@econsultor/shared';
import type { Config } from '../../config.js';
import { badRequest, AppError } from '../../lib/errors.js';
import { addDays } from '../../lib/dates.js';
import type { Store, UserRecord } from '../../store/types.js';
import { aiCategorize, aiExtractStatement } from './ai.js';
import { categorize, haystack } from './categorize.js';
import { rowsFromCsv } from './csv.js';
import { pdfLines, rowsFromPdfLines } from './pdf.js';
import type { ImportPreview, ImportRow, RawRow } from './types.js';

export const MAX_ROWS = 5000;

export interface AnalyzeInput {
  kind: 'csv' | 'pdf';
  /** CSV: texto. PDF: contenido en base64. */
  content: string;
  useAi: boolean;
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

  if (input.kind === 'csv') {
    try {
      const r = rowsFromCsv(input.content);
      raw = r.rows;
      warnings.push(...r.warnings);
    } catch (e) {
      throw unprocessable((e as Error).message);
    }
  } else {
    const data = Buffer.from(input.content, 'base64');
    if (data.length < 100 || data.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest('El archivo no parece un PDF válido');
    let lines: string[] = [];
    try {
      lines = await pdfLines(new Uint8Array(data));
    } catch {
      throw unprocessable('No he podido abrir el PDF (¿está protegido con contraseña o dañado?). Prueba con el CSV.');
    }
    if (lines.length === 0) {
      throw unprocessable('Este PDF no tiene texto (parece una imagen escaneada). Descarga el CSV desde la web del banco; con N26: web app → descargar → CSV.', 'scanned_pdf');
    }
    const r = rowsFromPdfLines(lines, Number(today.slice(0, 4)));
    raw = r.rows;
    warnings.push(...r.warnings);
    if (raw.length < 3 && input.useAi && cfg.anthropicApiKey) {
      const ai = await aiExtractStatement(cfg, lines.join('\n'));
      if (ai && ai.length > raw.length) { raw = ai; engine = 'ai'; warnings.length = 0; }
    }
    if (raw.length === 0) {
      throw unprocessable('No he encontrado movimientos en este PDF: su formato no es el habitual. Prueba con el CSV' + (cfg.anthropicApiKey ? ' o activa «Mejorar con IA».' : '.'));
    }
  }

  // Saneado: fechas razonables, importes distintos de cero y tope de filas.
  const maxDate = addDays(today, 1);
  const before = raw.length;
  raw = raw.filter((r) => r.date >= '2000-01-01' && r.date <= maxDate && r.amountMinor !== 0);
  if (raw.length < before) warnings.push(`${before - raw.length} movimientos con fecha futura o anterior al año 2000 se han descartado.`);
  if (raw.length === 0) throw unprocessable('No hay movimientos válidos en el archivo.');
  if (raw.length > MAX_ROWS) throw new AppError(413, 'too_many_rows', `El archivo tiene ${raw.length} movimientos; el máximo por importación es ${MAX_ROWS}. Divide el extracto por años.`);

  // Categorización: reglas offline y, si el usuario lo pide, IA para lo que no reconocen.
  const cats = raw.map(categorize);
  if (input.useAi && cfg.anthropicApiKey) {
    const unknown = cats.map((c, i) => ({ c, i })).filter(({ c }) => c.confidence === 'low');
    if (unknown.length) {
      const res = await aiCategorize(cfg, unknown.map(({ i }) => ({ i, text: haystack(raw[i]!), amountMinor: raw[i]!.amountMinor })));
      if (res.size) engine = 'ai';
      for (const [i, id] of res) cats[i] = { ...cats[i]!, categoryId: id, confidence: 'medium', via: 'ai' as const };
    }
  }

  // Duplicados: multiconjunto (fecha, importe, tipo) frente a lo ya guardado.
  const dates = raw.map((r) => r.date).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const existing = await store.transactions.list(user.id, { from, to, limit: 20_000 });
  const seen = new Map<string, number>();
  for (const t of existing) {
    const k = `${t.date}|${t.amountMinor}|${t.type}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }

  const rows: ImportRow[] = raw.map((r, i) => {
    const c = cats[i]!;
    const type = categoryById(c.categoryId)?.type ?? (r.amountMinor > 0 ? 'income' : 'expense');
    const amountMinor = Math.abs(r.amountMinor);
    const row: ImportRow = { id: randomUUID(), date: r.date, type, categoryId: c.categoryId, amountMinor, note: note(r), confidence: c.confidence, via: c.via };
    const k = `${r.date}|${amountMinor}|${type}`;
    const left = seen.get(k) ?? 0;
    if (left > 0) { seen.set(k, left - 1); row.skip = 'duplicate'; }
    else if (c.internal) row.skip = 'internal';
    return row;
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));

  const kept = rows.filter((r) => !r.skip);
  const sum = (t: 'income' | 'expense') => kept.filter((r) => r.type === t).reduce((s, r) => s + r.amountMinor, 0);
  const skipped = rows.length - kept.length;
  if (skipped) warnings.push(`${skipped === 1 ? 'Hay 1 movimiento desmarcado' : `Hay ${skipped} movimientos desmarcados`}: duplicados de lo que ya tienes o traspasos entre tus propias cuentas. Márcalos si los quieres importar.`);
  const lowCount = kept.filter((r) => r.confidence === 'low').length;
  if (lowCount) warnings.push(`No he sabido clasificar con seguridad ${lowCount === 1 ? '1 movimiento' : `${lowCount} movimientos`}: están como «Otros» y resaltados. Cambia su categoría antes de importar.`);

  return {
    source: input.kind,
    engine,
    rows,
    warnings,
    stats: { total: rows.length, income: kept.filter((r) => r.type === 'income').length, expense: kept.filter((r) => r.type === 'expense').length, skipped, from, to, incomeMinor: sum('income'), expenseMinor: sum('expense') },
  };
}

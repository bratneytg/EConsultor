import { strFromU8, unzipSync } from 'fflate';
import { tr } from '../../lib/i18n.js';

/** Una hoja de cálculo ya leída: celdas como texto (las fechas, en ISO; los importes, con punto decimal). */
export interface Sheet { name: string; rows: string[][] }

const MAX_TOTAL = 120 * 1024 * 1024; // descomprimido, todo el archivo
const MAX_PART = 60 * 1024 * 1024;
const MAX_ROWS = 60_000;
const MAX_COLS = 80;

export class SheetError extends Error {
  constructor(message: string) { super(tr(message)); }
}

const entities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const attr = (tag: string, name: string): string | undefined => tag.match(new RegExp(`(?:^|\\s)${name.replace(/[:.]/g, '\\$&')}="([^"]*)"`))?.[1];

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Serie de fecha de Excel (días desde 1899-12-30) → AAAA-MM-DD. */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80_000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function numText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const c = Math.round(n * 100);
  return Math.abs(n * 100 - c) < 1e-6 ? (c / 100).toFixed(2) : String(n);
}

function unzip(data: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(data, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_TOTAL) throw new SheetError('El archivo es demasiado grande una vez descomprimido.');
        return wanted(f.name) && f.originalSize <= MAX_PART;
      },
    });
  } catch (e) {
    if (e instanceof SheetError) throw e;
    throw new SheetError('No he podido abrir el archivo: no es un Excel válido o está dañado.');
  }
}

const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function dateStyles(styles: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!styles) return out;
  const custom = new Map<number, boolean>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = entities(attr(m[0], 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    custom.set(id, /[dmy]/i.test(code) && !/^general$/i.test(code));
  }
  const xfs = styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '';
  let i = 0;
  for (const m of xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    if (BUILTIN_DATE_FMT.has(id) || custom.get(id)) out.add(i);
    i++;
  }
  return out;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const body = m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    out.push(entities([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }
  return out;
}

function readXlsx(files: Record<string, Uint8Array>): Sheet[] {
  const text = (n: string): string | undefined => (files[n] ? strFromU8(files[n]!) : undefined);
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new SheetError('El archivo no tiene hojas de cálculo.');
  const rels = new Map<string, string>();
  for (const m of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const strings = sharedStrings(text('xl/sharedStrings.xml'));
  const dates = dateStyles(text('xl/styles.xml'));
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    if (/hidden/i.test(attr(m[0], 'state') ?? '')) continue;
    const path = rels.get(attr(m[0], 'r:id') ?? '');
    const xml = path ? text(path) : undefined;
    if (!xml) continue;
    const rows: string[][] = [];
    let rowNo = 0;
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      rowNo = Number(attr(r[1]!, 'r') ?? rowNo + 1);
      if (rowNo > MAX_ROWS) break;
      const row: string[] = [];
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = c[1]!;
        const col = colIndex(attr(a, 'r') ?? '');
        if (col < 0 || col >= MAX_COLS) continue;
        const t = attr(a, 't');
        const v = c[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        let out = '';
        if (t === 'inlineStr') out = entities([...(c[2] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (v !== undefined) {
          if (t === 's') out = strings[Number(v)] ?? '';
          else if (t === 'str') out = entities(v);
          else if (t === 'b' || t === 'e') out = '';
          else {
            const n = Number(v);
            const style = Number(attr(a, 's') ?? -1);
            out = Number.isFinite(n) ? (dates.has(style) ? (serialToIso(n) ?? numText(n)) : numText(n)) : v;
          }
        }
        row[col] = out;
      }
      rows[rowNo - 1] = Array.from(row, (x) => x ?? '');
    }
    sheets.push({ name: entities(attr(m[0], 'name') ?? ''), rows: Array.from(rows, (r) => r ?? []) });
  }
  return sheets;
}

function readOds(files: Record<string, Uint8Array>): Sheet[] {
  const xml = files['content.xml'] ? strFromU8(files['content.xml']!) : '';
  if (!xml) throw new SheetError('El archivo no tiene hojas de cálculo.');
  const sheets: Sheet[] = [];
  for (const t of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const rows: string[][] = [];
    for (const r of t[2]!.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
      const repeat = Math.min(Number(attr(r[1]!, 'table:number-rows-repeated') ?? 1), 500);
      const row: string[] = [];
      for (const c of (r[2] ?? '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
        const a = c[1]!;
        const type = attr(a, 'office:value-type');
        let out = '';
        if (type === 'date') out = (attr(a, 'office:date-value') ?? '').slice(0, 10);
        else if (type === 'float' || type === 'currency' || type === 'percentage') out = attr(a, 'office:value') ?? '';
        else out = entities((c[2] ?? '').replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<\/text:p>\s*<text:p[^>]*>/g, '\n').replace(/<[^>]+>/g, ''));
        const times = Math.min(Number(attr(a, 'table:number-columns-repeated') ?? 1), MAX_COLS);
        for (let i = 0; i < times && row.length < MAX_COLS; i++) row.push(out);
      }
      const filled = row.some((x) => x.trim());
      for (let i = 0; i < (filled ? repeat : 1) && rows.length < MAX_ROWS; i++) rows.push(filled ? row : []);
    }
    sheets.push({ name: entities(attr(t[1]!, 'table:name') ?? ''), rows });
  }
  return sheets;
}

/** Lee un .xlsx o un .ods. Los .xls antiguos (formato binario) no se admiten: hay que guardarlos como .xlsx o CSV. */
export function readSpreadsheet(data: Uint8Array): Sheet[] {
  const head = Buffer.from(data.subarray(0, 8));
  if (head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new SheetError('Este es un Excel antiguo (.xls). Ábrelo y guárdalo como .xlsx o como CSV (Archivo › Guardar como) y vuelve a subirlo.');
  }
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new SheetError('El archivo no parece un Excel (.xlsx) ni una hoja de LibreOffice (.ods).');
  const files = unzip(data, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n) || n === 'content.xml');
  const sheets = files['xl/workbook.xml'] ? readXlsx(files) : files['content.xml'] ? readOds(files) : [];
  if (!sheets.length) throw new SheetError('No he encontrado hojas de cálculo en el archivo.');
  return sheets;
}

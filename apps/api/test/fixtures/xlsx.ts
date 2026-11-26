import { strToU8, zipSync } from 'fflate';

/** Celda: texto, número, fecha (se guarda como número de serie con formato de fecha) o vacía. */
export type Cell = string | number | { date: string } | null;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i: number): string => String.fromCharCode(65 + i);
const serial = (iso: string): number => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

/** .xlsx mínimo pero válido, hecho a mano, para probar el lector sin depender de Excel. */
export function makeXlsx(sheets: { name: string; rows: Cell[][]; hidden?: boolean }[], opts: { sharedStrings?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const sst = (s: string): number => { let i = shared.indexOf(s); if (i < 0) { i = shared.length; shared.push(s); } return i; };
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows.map((r, ri) => {
      const cells = r.map((c, ci) => {
        const ref = `${col(ci)}${ri + 1}`;
        if (c === null) return '';
        if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
        if (typeof c === 'object') return `<c r="${ref}" s="1"><v>${serial(c.date)}</v></c>`;
        return opts.sharedStrings === false ? `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>` : `<c r="${ref}" t="s"><v>${sst(c)}</v></c>`;
      });
      return `<row r="${ri + 1}">${cells.join('')}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`;
  });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`),
    'xl/styles.xml': strToU8('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>'),
  };
  sheetXml.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x); });
  if (shared.length) files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  return zipSync(files, { level: 1 });
}

/** .ods mínimo (LibreOffice / OpenOffice). */
export function makeOds(name: string, rows: Cell[][]): Uint8Array {
  const body = rows.map((r) => `<table:table-row>${r.map((c) => {
    if (c === null) return '<table:table-cell/>';
    if (typeof c === 'number') return `<table:table-cell office:value-type="float" office:value="${c}"><text:p>${c}</text:p></table:table-cell>`;
    if (typeof c === 'object') return `<table:table-cell office:value-type="date" office:date-value="${c.date}"><text:p>${c.date}</text:p></table:table-cell>`;
    return `<table:table-cell office:value-type="string"><text:p>${esc(c)}</text:p></table:table-cell>`;
  }).join('')}</table:table-row>`).join('');
  const content = `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet><table:table table:name="${esc(name)}">${body}</table:table></office:spreadsheet></office:body></office:document-content>`;
  return zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'), 'content.xml': strToU8(content) }, { level: 1 });
}

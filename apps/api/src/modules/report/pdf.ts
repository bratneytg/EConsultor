import { categoryFamily, type Overview, type Transaction } from '@econsultor/shared';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { curLang, localeOf, tr } from '../../lib/i18n.js';
import { shiftMonth } from '../../lib/dates.js';
import type { Narrative } from './narrative.js';
import { monthName } from './narrative.js';

/** Colores de las familias (los mismos que la app en tema claro). */
const FAMILY_HEX: Record<string, string> = {
  home: '#3987e5', food: '#d95926', move: '#199e70', subs: '#c98500', fun: '#d55181', shop: '#0ca30c', care: '#9085e9', other: '#898781',
};
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex('#1b1f23');
const MUTED = hex('#6a7078');
const RULE = hex('#d9dce0');
const PANEL = hex('#f3f5f7');
const INCOME = hex('#199e70');
const EXPENSE = hex('#d95926');
const ACCENT = hex('#1f4e79');

const W = 595.28;
const H = 841.89;
const M = 44;
const CW = W - 2 * M;

export interface ReportInput {
  overview: Overview;
  monthTxs: Transaction[];
  narrative: Narrative;
  userName: string;
  label: (categoryId: string) => string;
  recurring: { name: string; day: number; categoryId: string; amountMinor: number; type: 'income' | 'expense' }[];
  generatedOn: string;
}

/** Enseña solo caracteres que la letra estándar del PDF sabe dibujar; lo demás pierde el acento o se cambia por «?». */
function makeSafe(font: PDFFont): (s: string) => string {
  const ok = new Set(font.getCharacterSet());
  return (s) => {
    let out = '';
    for (const ch of s.replace(/ /g, ' ').replace(/[\r\n\t]+/g, ' ')) {
      const cp = ch.codePointAt(0)!;
      if (ok.has(cp)) { out += ch; continue; }
      const plain = ch.normalize('NFD').replace(/\p{M}/gu, '');
      out += plain && [...plain].every((c) => ok.has(c.codePointAt(0)!)) ? plain : '?';
    }
    return out;
  };
}

class Layout {
  doc!: PDFDocument;
  regular!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  safe!: (s: string) => string;

  static async create(): Promise<Layout> {
    const l = new Layout();
    l.doc = await PDFDocument.create();
    l.regular = await l.doc.embedFont(StandardFonts.Helvetica);
    l.bold = await l.doc.embedFont(StandardFonts.HelveticaBold);
    l.safe = makeSafe(l.regular);
    l.newPage();
    return l;
  }

  newPage(): void {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - M;
  }

  /** Si no cabe lo que viene, salta de página. */
  ensure(height: number): void {
    if (this.y - height < M + 22) this.newPage();
  }

  width(s: string, size: number, bold = false): number {
    return (bold ? this.bold : this.regular).widthOfTextAtSize(this.safe(s), size);
  }

  /** Parte un texto en líneas que caben en `maxW`. */
  wrap(s: string, size: number, maxW: number, bold = false): string[] {
    const f = bold ? this.bold : this.regular;
    const lines: string[] = [];
    let cur = '';
    for (const raw of this.safe(s).split(' ')) {
      // Una palabra más larga que la línea se parte por letras.
      let word = raw;
      while (f.widthOfTextAtSize(word, size) > maxW && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && f.widthOfTextAtSize(word.slice(0, n), size) > maxW) n--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      const test = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) <= maxW) cur = test;
      else { if (cur) lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  text(s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: RGB; align?: 'left' | 'right' | 'center'; maxW?: number } = {}): void {
    const size = o.size ?? 10;
    let t = this.safe(s);
    const f = o.bold ? this.bold : this.regular;
    if (o.maxW) while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.maxW) t = `${t.slice(0, -2).trimEnd()}…`;
    const w = f.widthOfTextAtSize(t, size);
    const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.page.drawText(t, { x: px, y, size, font: f, color: o.color ?? INK });
  }

  /** Párrafo con salto de línea automático; devuelve cuánto ha bajado. */
  paragraph(s: string, o: { size?: number; leading?: number; bold?: boolean; color?: RGB; x?: number; maxW?: number; gap?: number } = {}): void {
    const size = o.size ?? 10;
    const leading = o.leading ?? size * 1.45;
    const x = o.x ?? M;
    const lines = this.wrap(s, size, o.maxW ?? CW - (x - M), o.bold);
    for (const line of lines) {
      this.ensure(leading);
      this.y -= leading;
      this.text(line, x, this.y + leading * 0.28, { size, bold: o.bold, color: o.color });
    }
    this.y -= o.gap ?? 6;
  }

  heading(s: string): void {
    this.ensure(52);
    this.y -= 14;
    this.text(s, M, this.y - 14, { size: 13, bold: true, color: ACCENT });
    this.y -= 20;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= 10;
  }

  rect(x: number, y: number, w: number, h: number, color: RGB): void {
    if (w > 0 && h > 0) this.page.drawRectangle({ x, y, width: w, height: h, color });
  }
}

const fmt = (minor: number, cur: string, digits = 2): string => {
  const s = (minor / 100).toLocaleString(localeOf(curLang()), { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits });
  return s;
};
const fmt0 = (minor: number, cur: string): string => fmt(minor, cur, 0);
const compact = (minor: number): string => {
  const v = Math.abs(minor) / 100;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(v));
};
const monthShortName = (m: string): string =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(localeOf(curLang()), { month: 'short', timeZone: 'UTC' }).replace('.', '');
const cap = (s: string): string => s.charAt(0).toLocaleUpperCase(localeOf(curLang())) + s.slice(1);
const shortDate = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString(localeOf(curLang()), { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

export async function renderMonthlyReport(inp: ReportInput): Promise<Uint8Array> {
  const L = await Layout.create();
  const { overview: o, narrative: n } = inp;
  const cur = o.currency;
  const prev = shiftMonth(o.month, -1);

  L.doc.setTitle(`${tr('Informe mensual')} · ${cap(monthName(o.month))}`);
  L.doc.setAuthor('EConsultor');
  L.doc.setCreator('EConsultor');
  L.doc.setLanguage(curLang());

  // ───────── Cabecera ─────────
  L.rect(0, H - 8, W, 8, ACCENT);
  L.y = H - M - 4;
  L.text('EConsultor', M, L.y - 8, { size: 10, bold: true, color: ACCENT });
  L.text(tr('Informe mensual'), W - M, L.y - 8, { size: 10, color: MUTED, align: 'right' });
  L.y -= 38;
  L.text(cap(monthName(o.month)), M, L.y - 6, { size: 28, bold: true });
  L.y -= 24;
  L.text(`${inp.userName} · ${cur} · ${inp.generatedOn}`, M, L.y - 4, { size: 9.5, color: MUTED });
  L.y -= 22;

  // ───────── Cifras clave ─────────
  const kpis: { label: string; value: string; sub: string; color: RGB }[] = [
    { label: tr('Ingresos'), value: fmt0(o.totals.incomeMinor, cur), sub: change(o.totals.incomeMinor, o.prevTotals.incomeMinor, prev), color: INCOME },
    { label: tr('Gastos'), value: fmt0(o.totals.expenseMinor, cur), sub: change(o.totals.expenseMinor, o.prevTotals.expenseMinor, prev), color: EXPENSE },
    { label: tr('Balance'), value: fmt0(o.totals.netMinor, cur), sub: o.totals.netMinor >= 0 ? tr('Te ha sobrado') : tr('Has gastado de más'), color: o.totals.netMinor >= 0 ? INCOME : EXPENSE },
    { label: tr('Tasa de ahorro'), value: o.totals.incomeMinor > 0 ? `${Math.round(o.totals.savingsRate * 100)} %` : '–', sub: tr('de tus ingresos'), color: ACCENT },
  ];
  const gap = 10;
  const kw = (CW - 3 * gap) / 4;
  kpis.forEach((k, i) => {
    const x = M + i * (kw + gap);
    L.rect(x, L.y - 62, kw, 62, PANEL);
    L.rect(x, L.y - 62, 3, 62, k.color);
    L.text(k.label, x + 12, L.y - 16, { size: 8.5, color: MUTED, maxW: kw - 18 });
    L.text(k.value, x + 12, L.y - 38, { size: 15, bold: true, maxW: kw - 18 });
    L.text(k.sub, x + 12, L.y - 53, { size: 8, color: MUTED, maxW: kw - 18 });
  });
  L.y -= 74;

  // ───────── Resumen escrito ─────────
  L.heading(tr('Resumen del mes'));
  L.paragraph(n.headline, { size: 12, leading: 17, bold: true, gap: 8 });
  for (const p of n.paragraphs) L.paragraph(p, { size: 10, leading: 14.5, gap: 5 });
  if (n.actions.length) {
    L.y -= 4;
    L.ensure(40);
    L.text(tr('Para el mes que viene'), M, L.y - 10, { size: 10.5, bold: true });
    L.y -= 18;
    for (const a of n.actions) {
      const lines = L.wrap(a, 10, CW - 16);
      L.ensure(lines.length * 14.5 + 4);
      L.y -= 14.5;
      L.text('•', M + 2, L.y + 4, { size: 10, color: ACCENT, bold: true });
      lines.forEach((ln, i) => { if (i) L.y -= 14.5; L.text(ln, M + 16, L.y + 4, { size: 10 }); });
      L.y -= 3;
    }
  }

  // ───────── En qué se va ─────────
  if (o.expenseByCategory.length) {
    L.heading(tr('En qué se va'));
    const cats = o.expenseByCategory;
    const shown = cats.slice(0, 12);
    const rest = cats.slice(12);
    const max = shown[0]!.amountMinor;
    const colName = M + 14;
    const barX = M + 168;
    const barW = 120;
    const amtX = M + 372;
    const pctX = M + 420;
    const dX = W - M;
    L.ensure(24);
    L.text(tr('Categoría'), colName, L.y - 8, { size: 8.5, color: MUTED });
    L.text(tr('Importe'), amtX, L.y - 8, { size: 8.5, color: MUTED, align: 'right' });
    L.text(tr('% del gasto'), pctX + 14, L.y - 8, { size: 8.5, color: MUTED, align: 'right' });
    L.text(tr('vs {month}', { month: monthShortName(prev) }), dX, L.y - 8, { size: 8.5, color: MUTED, align: 'right' });
    L.y -= 18;
    const row = (name: string, color: RGB, amount: number, share: number, previous: number): void => {
      L.ensure(20);
      L.y -= 19;
      L.rect(M, L.y + 3, 8, 8, color);
      L.text(name, colName, L.y + 3, { size: 9.5, maxW: 150 });
      L.rect(barX, L.y + 3, Math.max(1.5, (amount / max) * barW), 8, color);
      L.text(fmt(amount, cur), amtX, L.y + 3, { size: 9.5, align: 'right' });
      L.text(`${Math.round(share * 100)} %`, pctX + 14, L.y + 3, { size: 9.5, align: 'right', color: MUTED });
      const d = previous > 0 ? (amount - previous) / previous : null;
      L.text(d === null ? '–' : `${d > 0 ? '+' : ''}${Math.round(d * 100)} %`, dX, L.y + 3, { size: 9.5, align: 'right', color: d === null ? MUTED : d > 0.03 ? EXPENSE : d < -0.03 ? INCOME : MUTED });
    };
    for (const c of shown) row(inp.label(c.categoryId), hex(FAMILY_HEX[categoryFamily(c.categoryId)] ?? FAMILY_HEX.other!), c.amountMinor, c.share, c.prevAmountMinor);
    if (rest.length) {
      row(tr('Otras categorías'), hex(FAMILY_HEX.other!), rest.reduce((s, c) => s + c.amountMinor, 0), rest.reduce((s, c) => s + c.share, 0), rest.reduce((s, c) => s + c.prevAmountMinor, 0));
    }
    L.y -= 6;
  }

  // ───────── Evolución ─────────
  const months = o.monthly.slice(-6);
  if (months.some((m) => m.incomeMinor > 0 || m.expenseMinor > 0)) {
    L.heading(tr('Evolución de los últimos meses'));
    const ch = 110;
    L.ensure(ch + 44);
    const top = L.y;
    const base = top - ch - 4;
    const maxV = Math.max(1, ...months.flatMap((m) => [m.incomeMinor, m.expenseMinor]));
    const slot = CW / months.length;
    const bw = Math.min(26, slot / 3);
    L.page.drawLine({ start: { x: M, y: base }, end: { x: W - M, y: base }, thickness: 0.6, color: RULE });
    months.forEach((m, i) => {
      const cx = M + slot * i + slot / 2;
      const ih = (m.incomeMinor / maxV) * (ch - 14);
      const eh = (m.expenseMinor / maxV) * (ch - 14);
      L.rect(cx - bw - 1, base, bw, ih, INCOME);
      L.rect(cx + 1, base, bw, eh, EXPENSE);
      if (m.incomeMinor > 0) L.text(compact(m.incomeMinor), cx - bw / 2 - 1, base + ih + 3, { size: 7.5, color: MUTED, align: 'center' });
      if (m.expenseMinor > 0) L.text(compact(m.expenseMinor), cx + bw / 2 + 1, base + eh + 3, { size: 7.5, color: MUTED, align: 'center' });
      L.text(cap(monthShortName(m.month)), cx, base - 12, { size: 8.5, color: m.month === o.month ? INK : MUTED, bold: m.month === o.month, align: 'center' });
    });
    L.y = base - 32;
    L.rect(M, L.y - 1, 8, 8, INCOME);
    L.text(tr('Ingresos'), M + 13, L.y, { size: 8.5, color: MUTED });
    L.rect(M + 70, L.y - 1, 8, 8, EXPENSE);
    L.text(tr('Gastos'), M + 83, L.y, { size: 8.5, color: MUTED });
    L.y -= 12;
  }

  // ───────── Día a día ─────────
  const days = o.daily;
  if (o.totals.expenseMinor > 0 && days.length > 0) {
    L.heading(tr('Gasto día a día'));
    const ch = 90;
    L.ensure(ch + 40);
    const base = L.y - ch - 4;
    const maxV = Math.max(1, ...days.map((d) => d.expenseMinor));
    const slot = CW / days.length;
    const avg = o.totals.expenseMinor / days.length;
    L.page.drawLine({ start: { x: M, y: base }, end: { x: W - M, y: base }, thickness: 0.6, color: RULE });
    const peakIdx = days.reduce((bi, d, i) => (d.expenseMinor > days[bi]!.expenseMinor ? i : bi), 0);
    days.forEach((d, i) => {
      const h = (d.expenseMinor / maxV) * (ch - 14);
      L.rect(M + slot * i + slot * 0.12, base, slot * 0.76, h, EXPENSE);
      if (i === 0 || (i + 1) % 5 === 0) L.text(String(i + 1), M + slot * i + slot / 2, base - 11, { size: 7.5, color: MUTED, align: 'center' });
    });
    const peak = days[peakIdx]!;
    if (peak.expenseMinor > 0) L.text(fmt0(peak.expenseMinor, cur), Math.min(W - M - 20, Math.max(M + 20, M + slot * peakIdx + slot / 2)), base + (peak.expenseMinor / maxV) * (ch - 14) + 3, { size: 7.5, color: MUTED, align: 'center' });
    // Línea de la media (discontinua).
    const ay = base + (avg / maxV) * (ch - 14);
    L.page.drawLine({ start: { x: M, y: ay }, end: { x: W - M, y: ay }, thickness: 0.8, color: INK, dashArray: [3, 3], opacity: 0.7 });
    L.y = base - 24;
    L.text(tr('Media diaria: {amount}', { amount: fmt(Math.round(avg), cur) }), M, L.y, { size: 8.5, color: MUTED });
    L.y -= 8;
  }

  // ───────── Mayores gastos ─────────
  const big = inp.monthTxs.filter((t) => t.type === 'expense').sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 10);
  if (big.length) {
    L.heading(tr('Mayores gastos del mes'));
    L.ensure(22);
    L.text(tr('Fecha'), M, L.y - 8, { size: 8.5, color: MUTED });
    L.text(tr('Categoría'), M + 44, L.y - 8, { size: 8.5, color: MUTED });
    L.text(tr('Nota'), M + 170, L.y - 8, { size: 8.5, color: MUTED });
    L.text(tr('Importe'), W - M, L.y - 8, { size: 8.5, color: MUTED, align: 'right' });
    L.y -= 16;
    for (const t of big) {
      L.ensure(18);
      L.y -= 17;
      L.text(shortDate(t.date), M, L.y + 3, { size: 9.5, color: MUTED });
      L.text(inp.label(t.categoryId), M + 44, L.y + 3, { size: 9.5, maxW: 120 });
      L.text(t.note ?? '', M + 170, L.y + 3, { size: 9.5, color: MUTED, maxW: 230 });
      L.text(fmt(t.amountMinor, cur), W - M, L.y + 3, { size: 9.5, align: 'right' });
    }
    L.y -= 4;
  }

  // ───────── Ingresos ─────────
  if (o.incomeByCategory.length) {
    L.heading(tr('Ingresos del mes'));
    for (const c of o.incomeByCategory) {
      L.ensure(18);
      L.y -= 17;
      L.rect(M, L.y + 3, 8, 8, INCOME);
      L.text(inp.label(c.categoryId), M + 14, L.y + 3, { size: 9.5, maxW: 300 });
      L.text(`${Math.round(c.share * 100)} %`, W - M - 110, L.y + 3, { size: 9.5, align: 'right', color: MUTED });
      L.text(fmt(c.amountMinor, cur), W - M, L.y + 3, { size: 9.5, align: 'right' });
    }
    L.y -= 4;
  }

  // ───────── Periódicos ─────────
  const rec = inp.recurring.filter((r) => r.type === 'expense');
  if (rec.length) {
    L.heading(tr('Gastos periódicos activos'));
    let total = 0;
    for (const r of rec) {
      L.ensure(18);
      L.y -= 17;
      total += r.amountMinor;
      L.text(r.name, M, L.y + 3, { size: 9.5, maxW: 200 });
      L.text(tr('Día {day}', { day: r.day }), M + 214, L.y + 3, { size: 9.5, color: MUTED });
      L.text(inp.label(r.categoryId), M + 270, L.y + 3, { size: 9.5, color: MUTED, maxW: 130 });
      L.text(fmt(r.amountMinor, cur), W - M, L.y + 3, { size: 9.5, align: 'right' });
    }
    L.ensure(22);
    L.y -= 20;
    L.text(tr('Total al mes'), M, L.y + 3, { size: 9.5, bold: true });
    L.text(fmt(total, cur), W - M, L.y + 3, { size: 9.5, bold: true, align: 'right' });
    L.y -= 4;
  }

  // ───────── Aviso final y pies de página ─────────
  L.ensure(40);
  L.y -= 16;
  L.paragraph(tr('Informe generado por EConsultor a partir de los movimientos anotados. Es una ayuda para entender tus finanzas, no asesoramiento financiero.'), { size: 8, color: MUTED, leading: 11 });

  const total = L.pages.length;
  L.pages.forEach((p, i) => {
    L.page = p;
    L.page.drawLine({ start: { x: M, y: M - 6 }, end: { x: W - M, y: M - 6 }, thickness: 0.5, color: RULE });
    L.text(`EConsultor · ${cap(monthName(o.month))}`, M, M - 20, { size: 8, color: MUTED });
    L.text(tr('Página {n} de {total}', { n: i + 1, total }), W - M, M - 20, { size: 8, color: MUTED, align: 'right' });
  });

  return L.doc.save();
}

/** «+12 % vs oct.» o, si el mes anterior no tiene datos, un guion. */
function change(cur: number, prev: number, prevMonth: string): string {
  if (prev <= 0) return tr('Sin datos de {month}', { month: monthShortName(prevMonth) });
  const d = (cur - prev) / prev;
  return `${d > 0 ? '+' : ''}${Math.round(d * 100)} % ${tr('vs {month}', { month: monthShortName(prevMonth) })}`;
}

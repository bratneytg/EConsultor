import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '../lib/auth';
import { ApiError, api } from '../lib/api';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryColor, categoryLabel } from '../lib/categories';
import { dayShort, money } from '../lib/format';
import { useAppConfig, useInvalidateData } from '../lib/queries';
import { Icon } from './Icon';

interface PreviewRow {
  id: string;
  date: string;
  type: 'income' | 'expense';
  categoryId: string;
  amountMinor: number;
  note: string;
  confidence: 'high' | 'medium' | 'low';
  via: string;
  skip?: 'duplicate' | 'internal';
}
interface Preview {
  source: 'csv' | 'pdf';
  engine: 'offline' | 'ai';
  rows: PreviewRow[];
  warnings: string[];
  stats: { total: number; income: number; expense: number; skipped: number; from: string; to: string; incomeMinor: number; expenseMinor: number };
}
interface Draft extends PreviewRow { on: boolean }
interface Commit { created: number; from: string; to: string; monthsCovered: number }

const MAX_FILE = 9 * 1024 * 1024;
const SHOWN = 300;
const SKIP_LABEL = { duplicate: 'Ya lo tienes', internal: 'Entre tus cuentas' } as const;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Los CSV de los bancos suelen venir en UTF-8, pero algunos en Windows-1252. */
function decodeText(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

interface Props { open: boolean; onClose: () => void; onDone: (message: string) => void }

export function ImportSheet({ open, onClose, onDone }: Props) {
  const user = useUser();
  const { data: cfg } = useAppConfig();
  const invalidate = useInvalidateData();
  const [step, setStep] = useState<'pick' | 'analyzing' | 'review' | 'importing'>('pick');
  const [error, setError] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const last = useRef<File | null>(null);

  useEffect(() => {
    if (open) { setStep('pick'); setError(''); setPreview(null); setRows([]); setUseAi(false); last.current = null; }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && step !== 'analyzing' && step !== 'importing' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);

  const analyze = useCallback(async (f: File, ai: boolean) => {
    setError('');
    if (f.size > MAX_FILE) return setError('El archivo pesa más de 9 MB. Divide el extracto por años.');
    const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    const isText = /\.(csv|txt|tsv)$/i.test(f.name) || f.type.startsWith('text/') || f.type === 'application/vnd.ms-excel';
    if (!isPdf && !isText) return setError('Solo se admiten archivos CSV o PDF.');
    last.current = f;
    setStep('analyzing');
    try {
      const buf = await f.arrayBuffer();
      const res = await api<Preview>('/import/preview', {
        method: 'POST',
        json: { kind: isPdf ? 'pdf' : 'csv', content: isPdf ? toBase64(buf) : decodeText(buf), useAi: ai },
      });
      setPreview(res);
      setRows(res.rows.map((r) => ({ ...r, on: !r.skip })));
      setStep('review');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo analizar el archivo. Inténtalo de nuevo.');
      setStep('pick');
    }
  }, []);

  const onFiles = (list: FileList | null) => { const f = list?.[0]; if (f) void analyze(f, useAi); };

  const chosen = useMemo(() => rows.filter((r) => r.on), [rows]);
  const totals = useMemo(() => ({
    income: chosen.filter((r) => r.type === 'income').reduce((s, r) => s + r.amountMinor, 0),
    expense: chosen.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amountMinor, 0),
  }), [chosen]);

  const setRow = (id: string, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setCategory = (id: string, categoryId: string) =>
    setRow(id, { categoryId, type: INCOME_CATEGORIES.some((c) => c.id === categoryId) ? 'income' : 'expense', confidence: 'high' });

  const commit = async () => {
    if (!chosen.length) return;
    setError('');
    setStep('importing');
    try {
      const res = await api<Commit>('/import/commit', {
        method: 'POST',
        json: { rows: chosen.map((r) => ({ date: r.date, categoryId: r.categoryId, amountMinor: r.amountMinor, note: r.note || undefined })) },
      });
      await invalidate();
      onDone(`${res.created} movimientos importados · tu perfil financiero está actualizado`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo importar. Inténtalo de nuevo.');
      setStep('review');
    }
  };

  const busy = step === 'analyzing' || step === 'importing';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()} />
          <motion.div
            className="sheet import-sheet" role="dialog" aria-modal="true" aria-label="Importar extractos bancarios"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 34, stiffness: 380 }}
          >
            <div className="grabber" />
            <div className="imp-head">
              <h2>Importar extractos bancarios</h2>
              <button className="icon-btn" aria-label="Cerrar" disabled={busy} onClick={onClose}><Icon name="x" size={20} /></button>
            </div>

            {step === 'pick' && (
              <>
                <input ref={file} type="file" hidden accept=".csv,.tsv,.txt,.pdf,text/csv,application/pdf" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
                <button
                  className="drop" data-drag={drag}
                  onClick={() => file.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
                >
                  <Icon name="upload" size={28} />
                  <b>Suelta aquí tu extracto o toca para elegirlo</b>
                  <span>CSV o PDF · hasta 9 MB</span>
                </button>

                <ul className="imp-notes">
                  <li>Lo leemos en el servidor, <b>sin enviarlo a ninguna IA</b>. Detectamos fechas, importes y categorías por reglas.</li>
                  <li>Antes de guardar nada verás el resultado y podrás corregirlo. Lo que ya tienes no se duplica.</li>
                  <li>Con N26, el CSV es lo más fiable: web app → Extractos → Descargar CSV. El PDF solo funciona si tiene texto, no si es una foto.</li>
                </ul>

                {cfg?.ai && (
                  <label className="imp-ai">
                    <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                    <span>
                      <b>Mejorar con IA</b>
                      <small>Para lo que las reglas no reconocen, se envían a Claude solo las descripciones de esos movimientos, sin IBAN ni emails.</small>
                    </span>
                  </label>
                )}
                {error && <p className="error" role="alert">{error}</p>}
              </>
            )}

            {step === 'analyzing' && (
              <div className="imp-wait" role="status"><span className="spinner" />Analizando fechas, importes y categorías…</div>
            )}

            {(step === 'review' || step === 'importing') && preview && (
              <>
                <div className="imp-summary">
                  <div><span>Movimientos</span><b className="num">{chosen.length}</b></div>
                  <div><span>Ingresos</span><b className="num pos">{money(totals.income, user.currency)}</b></div>
                  <div><span>Gastos</span><b className="num">{money(totals.expense, user.currency)}</b></div>
                </div>
                <p className="hint imp-range">
                  Del {dayShort(preview.stats.from)} {preview.stats.from.slice(0, 4)} al {dayShort(preview.stats.to)} {preview.stats.to.slice(0, 4)}
                  {preview.engine === 'ai' ? ' · mejorado con IA' : ' · análisis sin conexión'}
                </p>
                {preview.warnings.map((w) => <p key={w} className="imp-warn"><Icon name="info" size={16} />{w}</p>)}

                <ul className="imp-list">
                  {rows.slice(0, SHOWN).map((r) => (
                    <li key={r.id} data-off={!r.on} data-low={r.on && r.confidence === 'low'}>
                      <label className="imp-check">
                        <input type="checkbox" checked={r.on} disabled={step === 'importing'} onChange={(e) => setRow(r.id, { on: e.target.checked })} aria-label={`Importar ${r.note || 'movimiento'}`} />
                      </label>
                      <div className="imp-main">
                        <div className="imp-line">
                          <span className="imp-note">{r.note || 'Sin descripción'}</span>
                          <b className={`num ${r.type === 'income' ? 'pos' : ''}`}>{r.type === 'income' ? '+' : '−'}{money(r.amountMinor, user.currency)}</b>
                        </div>
                        <div className="imp-line sub">
                          <span>{dayShort(r.date)} {r.date.slice(0, 4)}{r.skip && <em className="imp-tag">{SKIP_LABEL[r.skip]}</em>}</span>
                          <select
                            className="imp-cat" value={r.categoryId} disabled={step === 'importing'} aria-label="Categoría"
                            style={{ ['--tile-c' as string]: categoryColor(r.categoryId) }} onChange={(e) => setCategory(r.id, e.target.value)}
                          >
                            <optgroup label="Gastos">{EXPENSE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}</optgroup>
                            <optgroup label="Ingresos">{INCOME_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}</optgroup>
                          </select>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {rows.length > SHOWN && <p className="hint">Se muestran los {SHOWN} más recientes. Los {rows.length - SHOWN} restantes se importan igualmente según su selección actual.</p>}

                {error && <p className="error" role="alert">{error}</p>}
                <div className="imp-actions">
                  <button className="btn btn-primary btn-block" disabled={!chosen.length || step === 'importing'} onClick={commit}>
                    {step === 'importing' ? 'Importando…' : `Importar ${chosen.length} movimientos`}
                  </button>
                  <button className="btn btn-block" disabled={step === 'importing'} onClick={() => { setStep('pick'); setPreview(null); setRows([]); }}>Elegir otro archivo</button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

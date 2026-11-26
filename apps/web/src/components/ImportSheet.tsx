import { AnimatePresence, motion } from 'framer-motion';
import { useBackClose } from '../lib/backClose';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '../lib/auth';
import { ApiError, api } from '../lib/api';
import { allExpenseCategories, allIncomeCategories, categoryColor, categoryLabel } from '../lib/categories';
import { dayShort, money } from '../lib/format';
import { t } from '../lib/i18n';
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
  skip?: 'duplicate' | 'internal' | 'other_account';
}
interface Preview {
  source: 'csv' | 'pdf' | 'sheet';
  engine: 'offline' | 'ai';
  rows: PreviewRow[];
  warnings: string[];
  signs?: { mode: 'normal' | 'inverted' | 'unsigned'; flipped: boolean };
  stats: { total: number; income: number; expense: number; skipped: number; from: string; to: string; incomeMinor: number; expenseMinor: number };
  account: string;
  accounts: AccountInfo[];
  sameStatement?: { matched: number; total: number };
  overlap?: { account: string; matched: number; total: number; ignored: boolean };
}
interface AccountInfo { name: string; count: number }
interface Opts { ai: boolean; flip: boolean; account: string; assume: boolean }
interface Draft extends PreviewRow { on: boolean }
interface Commit { created: number; from: string; to: string; monthsCovered: number }

const MAX_FILE = 9 * 1024 * 1024;
const SHOWN = 300;
const skipLabel = (k: NonNullable<PreviewRow['skip']>) =>
  ({ duplicate: t('Ya lo tienes'), internal: t('Entre tus cuentas'), other_account: t('Ya está en otra cuenta') })[k];
const accountName = (n: string) => n || t('Cuenta principal');
const NEW = '__new__';

/** Selector de cuenta: las que ya existen, la principal y una nueva con nombre libre. */
function AccountPicker({ value, known, disabled, onPick }: { value: string; known: AccountInfo[]; disabled?: boolean; onPick: (name: string) => void }) {
  const names = useMemo(() => Array.from(new Set(['', ...known.map((a) => a.name), ...(value ? [value] : [])])), [known, value]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const apply = () => { const n = draft.trim().slice(0, 40); if (n) { onPick(n); setAdding(false); setDraft(''); } };
  return (
    <div className="imp-account">
      <label>
        <span>{t('Cuenta del extracto')}</span>
        <select value={adding ? NEW : value} disabled={disabled} onChange={(e) => (e.target.value === NEW ? setAdding(true) : (setAdding(false), onPick(e.target.value)))}>
          {names.map((n) => <option key={n || 'main'} value={n}>{accountName(n)}</option>)}
          <option value={NEW}>{t('Otra cuenta nueva…')}</option>
        </select>
      </label>
      {adding && (
        <div className="imp-account-new">
          <input
            value={draft} maxLength={40} autoFocus disabled={disabled} placeholder={t('Nombre, por ejemplo «Nexi» o «Ahorro»')} aria-label={t('Nombre de la cuenta nueva')}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())}
          />
          <button type="button" className="btn" disabled={disabled || !draft.trim()} onClick={apply}>{t('Usar')}</button>
        </div>
      )}
    </div>
  );
}

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
  const [known, setKnown] = useState<AccountInfo[]>([]);
  const [account, setAccount] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const opts = useRef<Opts>({ ai: false, flip: false, account: '', assume: false });
  const file = useRef<HTMLInputElement>(null);
  const last = useRef<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('pick'); setError(''); setPreview(null); setRows([]); setUseAi(false); last.current = null; setAccount(''); setShowPicker(false);
    opts.current = { ai: false, flip: false, account: '', assume: false };
    api<{ accounts: AccountInfo[] }>('/import/accounts').then((r) => setKnown(r.accounts)).catch(() => setKnown([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && step !== 'analyzing' && step !== 'importing' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);

  const analyze = useCallback(async (f: File, o: Opts, keepReview = false) => {
    setError('');
    if (f.size > MAX_FILE) return setError(t('El archivo pesa más de 9 MB. Divide el extracto por años.'));
    const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    // Windows etiqueta los .csv como «ms-excel»: manda la extensión.
    const isSheet = /\.(xlsx|xlsm|xls|ods)$/i.test(f.name) || /spreadsheetml|opendocument\.spreadsheet/.test(f.type);
    const isText = /\.(csv|txt|tsv)$/i.test(f.name) || f.type.startsWith('text/') || f.type === 'application/vnd.ms-excel';
    if (!isPdf && !isSheet && !isText) return setError(t('Solo se admiten archivos CSV, Excel (.xlsx), LibreOffice (.ods) o PDF.'));
    last.current = f;
    opts.current = o;
    setStep('analyzing');
    try {
      const buf = await f.arrayBuffer();
      const binary = isPdf || isSheet;
      const res = await api<Preview>('/import/preview', {
        method: 'POST',
        json: {
          kind: isPdf ? 'pdf' : isSheet ? 'sheet' : 'csv', content: binary ? toBase64(buf) : decodeText(buf),
          useAi: o.ai, flipSigns: o.flip, account: o.account || undefined, assumeDifferentAccount: o.assume || undefined,
        },
      });
      setPreview(res);
      setKnown(res.accounts);
      setRows(res.rows.map((r) => ({ ...r, on: !r.skip })));
      setStep('review');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo analizar el archivo. Inténtalo de nuevo.'));
      setStep(keepReview ? 'review' : 'pick');
    }
  }, []);

  /** Vuelve a analizar el mismo archivo cambiando solo algunas opciones. */
  const reanalyze = (patch: Partial<Opts>) => { if (last.current) void analyze(last.current, { ...opts.current, ...patch }, true); };
  const pickAccount = (name: string) => {
    setAccount(name);
    // Al cambiar de cuenta se vuelve a preguntar por posibles repetidos.
    if (last.current && (step === 'review')) reanalyze({ account: name, assume: false }); else opts.current = { ...opts.current, account: name, assume: false };
  };

  const onFiles = (list: FileList | null) => { const f = list?.[0]; if (f) void analyze(f, { ai: useAi, flip: false, account, assume: false }); };

  const chosen = useMemo(() => rows.filter((r) => r.on), [rows]);
  const totals = useMemo(() => ({
    income: chosen.filter((r) => r.type === 'income').reduce((s, r) => s + r.amountMinor, 0),
    expense: chosen.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amountMinor, 0),
  }), [chosen]);

  const setRow = (id: string, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setCategory = (id: string, categoryId: string) =>
    setRow(id, { categoryId, type: allIncomeCategories().some((c) => c.id === categoryId) ? 'income' : 'expense', confidence: 'high' });

  const commit = async () => {
    if (!chosen.length) return;
    setError('');
    setStep('importing');
    try {
      const res = await api<Commit>('/import/commit', {
        method: 'POST',
        json: { account: account || undefined, rows: chosen.map((r) => ({ date: r.date, categoryId: r.categoryId, amountMinor: r.amountMinor, note: r.note || undefined })) },
      });
      await invalidate();
      onDone(t('{n} movimientos importados · tu perfil financiero está actualizado', { n: res.created }));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo importar. Inténtalo de nuevo.'));
      setStep('review');
    }
  };

  const busy = step === 'analyzing' || step === 'importing';
  useBackClose(open, onClose, () => !busy);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && onClose()} />
          <motion.div
            className="sheet import-sheet" role="dialog" aria-modal="true" aria-label={t('Importar extractos bancarios')}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 34, stiffness: 380 }}
          >
            <div className="grabber" />
            <div className="imp-head">
              <h2>{t('Importar extractos bancarios')}</h2>
              <button className="icon-btn" aria-label={t('Cerrar')} disabled={busy} onClick={onClose}><Icon name="x" size={20} /></button>
            </div>

            {step === 'pick' && (
              <>
                <input ref={file} type="file" hidden accept=".csv,.tsv,.txt,.pdf,.xlsx,.xlsm,.xls,.ods,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet" onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
                {known.length > 0 || showPicker ? (
                  <AccountPicker value={account} known={known} onPick={pickAccount} />
                ) : (
                  <p className="hint imp-more">
                    <button type="button" className="link-btn" onClick={() => setShowPicker(true)}>{t('¿Es de otra cuenta? Indica cuál')}</button>
                  </p>
                )}
                <button
                  className="drop" data-drag={drag}
                  onClick={() => file.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
                >
                  <Icon name="upload" size={28} />
                  <b>{t('Suelta aquí tu extracto o toca para elegirlo')}</b>
                  <span>{t('CSV, Excel, LibreOffice o PDF · hasta 9 MB')}</span>
                </button>

                <ul className="imp-notes">
                  <li>{t('Lo leemos en el servidor, sin enviarlo a ninguna IA. Detectamos fechas, importes y categorías por reglas.')}</li>
                  <li>{t('Antes de guardar nada verás el resultado y podrás corregirlo. Lo que ya tienes no se duplica.')}</li>
                  <li>{t('Lo más fiable es el CSV o el Excel (.xlsx) que te da el banco; el PDF solo funciona si tiene texto, no si es una foto. Con N26: web app → Extractos → Descargar CSV.')}</li>
                  <li>{t('Si tienes varias cuentas, importa cada extracto indicando su cuenta. Si subes por error uno que ya tenías, te avisamos.')}</li>
                  <li>{t('Entiende extractos de cuenta y de tarjeta (incluidas las que ponen los gastos en positivo, como Nexi), en euros, con fechas y números al estilo de España, Alemania o Italia.')}</li>
                </ul>

                {cfg?.ai && (
                  <label className="imp-ai">
                    <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
                    <span>
                      <b>{t('Mejorar con IA')}</b>
                      <small>{t('Para lo que las reglas no reconocen, se envían a Claude solo las descripciones de esos movimientos, sin IBAN ni emails.')}</small>
                    </span>
                  </label>
                )}
                {error && <p className="error" role="alert">{error}</p>}
              </>
            )}

            {step === 'analyzing' && (
              <div className="imp-wait" role="status"><span className="spinner" />{t('Analizando fechas, importes y categorías…')}</div>
            )}

            {(step === 'review' || step === 'importing') && preview && (
              <>
                <div className="imp-summary">
                  <div><span>{t('Movimientos')}</span><b className="num">{chosen.length}</b></div>
                  <div><span>{t('Ingresos')}</span><b className="num pos">{money(totals.income, user.currency)}</b></div>
                  <div><span>{t('Gastos')}</span><b className="num">{money(totals.expense, user.currency)}</b></div>
                </div>
                <p className="hint imp-range">
                  {t('Del {from} al {to}', { from: `${dayShort(preview.stats.from)} ${preview.stats.from.slice(0, 4)}`, to: `${dayShort(preview.stats.to)} ${preview.stats.to.slice(0, 4)}` })}
                  {preview.engine === 'ai' ? t(' · mejorado con IA') : t(' · análisis sin conexión')}
                </p>
                <AccountPicker value={account} known={known} disabled={step === 'importing'} onPick={pickAccount} />
                {preview.sameStatement && (
                  <p className="imp-warn imp-dup" role="status">
                    <Icon name="info" size={16} />
                    <span>{t('Este extracto ya estaba importado en «{account}»: {matched} de {total} movimientos coinciden, así que no hay nada nuevo que añadir.', { account: accountName(preview.account), matched: preview.sameStatement.matched, total: preview.sameStatement.total })}</span>
                  </p>
                )}
                {preview.overlap && !preview.overlap.ignored && (
                  <div className="imp-warn imp-dup" role="alert">
                    <Icon name="info" size={16} />
                    <div>
                      <p>{t('Este extracto se parece mucho al de tu cuenta «{account}»: {matched} de {total} movimientos coinciden en fecha, importe y descripción. ¿Lo subiste por error?', { account: accountName(preview.overlap.account), matched: preview.overlap.matched, total: preview.overlap.total })}</p>
                      <div className="imp-dup-actions">
                        <button type="button" className="btn" disabled={step === 'importing'} onClick={() => { setAccount(preview.overlap!.account); reanalyze({ account: preview.overlap!.account, assume: false }); }}>{t('Es esa misma cuenta')}</button>
                        <button type="button" className="btn" disabled={step === 'importing'} onClick={() => reanalyze({ assume: true })}>{t('Es otra cuenta distinta')}</button>
                      </div>
                    </div>
                  </div>
                )}
                {preview.overlap?.ignored && (
                  <p className="hint imp-range">{t('Se importará como una cuenta distinta de «{account}», aunque algunos movimientos se parezcan.', { account: accountName(preview.overlap.account) })}</p>
                )}
                {preview.warnings.map((w) => <p key={w} className="imp-warn"><Icon name="info" size={16} />{w}</p>)}
                <p className="hint imp-flip">
                  {t('¿Los gastos salen como ingresos, o al revés?')}{' '}
                  <button type="button" className="link-btn" disabled={step === 'importing' || !last.current} onClick={() => reanalyze({ flip: !preview.signs?.flipped })}>
                    {preview.signs?.flipped ? t('Volver a como estaba') : t('Invertir gastos e ingresos')}
                  </button>
                </p>

                <ul className="imp-list">
                  {rows.slice(0, SHOWN).map((r) => (
                    <li key={r.id} data-off={!r.on} data-low={r.on && r.confidence === 'low'}>
                      <label className="imp-check">
                        <input type="checkbox" checked={r.on} disabled={step === 'importing'} onChange={(e) => setRow(r.id, { on: e.target.checked })} aria-label={t('Importar {name}', { name: r.note || t('movimiento') })} />
                      </label>
                      <div className="imp-main">
                        <div className="imp-line">
                          <span className="imp-note">{r.note || t('Sin descripción')}</span>
                          <b className={`num ${r.type === 'income' ? 'pos' : ''}`}>{r.type === 'income' ? '+' : '−'}{money(r.amountMinor, user.currency)}</b>
                        </div>
                        <div className="imp-line sub">
                          <span>{dayShort(r.date)} {r.date.slice(0, 4)}{r.skip && <em className="imp-tag">{skipLabel(r.skip)}</em>}</span>
                          <select
                            className="imp-cat" value={r.categoryId} disabled={step === 'importing'} aria-label={t('Categoría')}
                            style={{ ['--tile-c' as string]: categoryColor(r.categoryId) }} onChange={(e) => setCategory(r.id, e.target.value)}
                          >
                            <optgroup label={t('Gastos')}>{allExpenseCategories().map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}</optgroup>
                            <optgroup label={t('Ingresos')}>{allIncomeCategories().map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}</optgroup>
                          </select>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {rows.length > SHOWN && <p className="hint">{t('Se muestran los {shown} más recientes. Los {rest} restantes se importan igualmente según su selección actual.', { shown: SHOWN, rest: rows.length - SHOWN })}</p>}

                {error && <p className="error" role="alert">{error}</p>}
                <div className="imp-actions">
                  <button className="btn btn-primary btn-block" disabled={!chosen.length || step === 'importing'} onClick={commit}>
                    {step === 'importing' ? t('Importando…') : t('Importar {n} movimientos', { n: chosen.length })}
                  </button>
                  <button className="btn btn-block" disabled={step === 'importing'} onClick={() => { setStep('pick'); setPreview(null); setRows([]); }}>{t('Elegir otro archivo')}</button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

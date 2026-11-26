import { AnimatePresence, motion } from 'framer-motion';
import { useBackClose } from '../lib/backClose';
import { useKeepAwake } from '../lib/keepAwake';
import { Aborted, clearSavedJob, discardJob, loadSavedJob, newKey, saveJob, startJob, waitJob, type JobProgress } from '../lib/importJob';
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
  /** Qué es el comercio según la IA, y si la IA lo buscó en internet. */
  hint?: string;
  web?: boolean;
}
interface AiInfo { identified: number; web: number; skippedWeb: number; problem?: 'unavailable' | 'web_unavailable' }
interface ClassifyResult { ai: AiInfo; warnings: string[]; results: { id: string; categoryId: string; hint: string; web: boolean }[] }
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
  ai?: AiInfo;
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

const STAGES: Record<string, () => string> = {
  queued: () => t('En cola…'),
  reading: () => t('Leyendo el archivo…'),
  rules: () => t('Reconociendo comercios…'),
  ai_knowledge: () => t('Claude está identificando comercios…'),
  ai_web: () => t('Buscando en internet los comercios que no se reconocen…'),
  checking: () => t('Comprobando movimientos repetidos…'),
};

/** Espera del análisis: qué está haciendo, cuánto lleva y que se puede apagar la pantalla o cambiar de app. */
function Wait({ progress, uploading, ai, compact, onClose, onCancel }: { progress: JobProgress | null; uploading?: boolean; ai: boolean; compact?: boolean; onClose?: () => void; onCancel?: () => void }) {
  const label = uploading ? t('Subiendo el archivo…') : (progress && STAGES[progress.stage]?.()) || t('Analizando tu extracto…');
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  return (
    <div className={`imp-wait${compact ? ' compact' : ''}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <b>{label}</b>
      {progress && progress.total > 0 && !uploading && <span className="imp-count num">{t('{done} de {total}', { done: progress.done, total: progress.total })}</span>}
      <div className="imp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} data-indet={pct === null}><i style={pct === null ? undefined : { width: `${pct}%` }} /></div>
      <p>{ai ? t('Puede tardar algunos minutos: Claude identifica los comercios y busca en internet los que no conoce.') : t('Puede tardar algunos minutos.')}</p>
      {uploading
        ? <small>{t('Mantén la app abierta unos segundos mientras se sube.')}</small>
        : <small>{t('Puedes apagar la pantalla o cambiar de app: el análisis sigue en el servidor y lo recuperas al volver.')}</small>}
      {(onClose || onCancel) && !uploading && (
        <div className="imp-wait-actions">
          {onClose && <button type="button" className="btn" onClick={onClose}>{t('Cerrar y seguir después')}</button>}
          {onCancel && <button type="button" className="btn" onClick={onCancel}>{t('Cancelar análisis')}</button>}
        </div>
      )}
    </div>
  );
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
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [resumedFile, setResumedFile] = useState('');
  const run = useRef<AbortController | null>(null);
  const jobId = useRef('');
  const opts = useRef<Opts>({ ai: false, flip: false, account: '', assume: false });
  const file = useRef<HTMLInputElement>(null);
  const last = useRef<File | null>(null);

  const busy = step === 'importing' || uploading;
  const close = useCallback(() => { run.current?.abort(); onClose(); }, [onClose]);

  /** Sigue una tarea del servidor hasta que acaba. Aunque la app se duerma o se cierre, la tarea sigue y se retoma. */
  const follow = useCallback(async (id: string, keepReview: boolean) => {
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    jobId.current = id;
    setStep('analyzing');
    try {
      const res = await waitJob<Preview>(id, { signal: ctl.signal, onProgress: setProgress });
      clearSavedJob();
      jobId.current = '';
      setPreview(res);
      setKnown(res.accounts);
      setRows(res.rows.map((r) => ({ ...r, on: !r.skip })));
      setStep('review');
    } catch (e) {
      if (e instanceof Aborted) return;
      clearSavedJob();
      jobId.current = '';
      setError(e instanceof ApiError ? e.message : t('No se pudo analizar el archivo. Inténtalo de nuevo.'));
      setStep(keepReview ? 'review' : 'pick');
    }
  }, []);

  useEffect(() => {
    if (!open) { run.current?.abort(); return; }
    setStep('pick'); setError(''); setPreview(null); setRows([]); setUseAi(false); last.current = null; setAccount(''); setShowPicker(false);
    setUploading(false); setProgress(null); setClassifying(false); setResumedFile(''); jobId.current = '';
    opts.current = { ai: false, flip: false, account: '', assume: false };
    api<{ accounts: AccountInfo[] }>('/import/accounts').then((r) => setKnown(r.accounts)).catch(() => setKnown([]));
    // Si había un análisis en marcha (cerraste la ventana, se apagó la pantalla, la app se reinició), se retoma.
    const saved = loadSavedJob();
    if (saved) {
      setResumedFile(saved.fileName); setUseAi(saved.ai); setAccount(saved.account);
      opts.current = { ai: saved.ai, flip: false, account: saved.account, assume: false };
      void follow(saved.id, false);
    }
    return () => run.current?.abort();
  }, [open, follow]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, busy]);

  useKeepAwake(open && (step === 'analyzing' || classifying));

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
    setResumedFile('');
    setProgress(null);
    setStep('analyzing');
    setUploading(true);
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    try {
      const buf = await f.arrayBuffer();
      const binary = isPdf || isSheet;
      // Se sube una sola vez: el servidor analiza por su cuenta y esta pantalla solo pregunta cómo va.
      const job = await startJob<Preview>('/import/jobs', {
        kind: isPdf ? 'pdf' : isSheet ? 'sheet' : 'csv', content: binary ? toBase64(buf) : decodeText(buf),
        useAi: o.ai, flipSigns: o.flip, account: o.account || undefined, assumeDifferentAccount: o.assume || undefined, key: newKey(),
      }, ctl.signal);
      saveJob({ id: job.id, fileName: f.name, startedAt: Date.now(), ai: o.ai, account: o.account });
      setUploading(false);
      await follow(job.id, keepReview);
    } catch (e) {
      setUploading(false);
      if (e instanceof Aborted) return;
      setError(e instanceof ApiError ? e.message : t('No se pudo analizar el archivo. Inténtalo de nuevo.'));
      setStep(keepReview ? 'review' : 'pick');
    }
  }, [follow]);

  /** Cancela el análisis en curso: se descarta en el servidor y se vuelve a elegir archivo. */
  const cancelAnalysis = () => {
    run.current?.abort();
    if (jobId.current) void discardJob(jobId.current);
    jobId.current = '';
    clearSavedJob();
    setResumedFile(''); setStep(preview ? 'review' : 'pick');
  };

  /** Pide a la IA que identifique SOLO lo que sigue sin clasificar; lo que ya se corrigió a mano no se toca. */
  const lowRows = useMemo(() => rows.filter((r) => r.confidence === 'low' && r.note.trim()), [rows]);
  const classify = async () => {
    setError('');
    setClassifying(true);
    setProgress(null);
    run.current?.abort();
    const ctl = new AbortController();
    run.current = ctl;
    try {
      const items = lowRows.slice(0, 1500).map((r) => ({ id: r.id, text: r.note.slice(0, 300), amountMinor: r.type === 'income' ? r.amountMinor : -r.amountMinor }));
      const job = await startJob<ClassifyResult>('/import/classify', { key: newKey(), items }, ctl.signal);
      const res = await waitJob<ClassifyResult>(job.id, { signal: ctl.signal, onProgress: setProgress });
      const hits = new Map(res.results.map((x) => [x.id, x]));
      setRows((rs) => rs.map((r) => {
        const h = hits.get(r.id);
        return h && r.confidence === 'low' ? { ...r, categoryId: h.categoryId, confidence: 'medium', via: 'ai', hint: h.hint, web: h.web } : r;
      }));
      setPreview((p) => p && { ...p, engine: res.results.length ? 'ai' : p.engine, ai: res.ai, warnings: [...p.warnings, ...res.warnings, ...(res.results.length ? [] : [t('La IA no ha podido identificar ninguno de esos movimientos. Elige su categoría a mano.')])] });
    } catch (e) {
      if (e instanceof Aborted) return;
      setError(e instanceof ApiError ? e.message : t('No se pudo analizar el archivo. Inténtalo de nuevo.'));
    } finally {
      setClassifying(false);
    }
  };

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
    setRow(id, { categoryId, type: allIncomeCategories().some((c) => c.id === categoryId) ? 'income' : 'expense', confidence: 'high', via: 'manual', hint: undefined, web: undefined });

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
      close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo importar. Inténtalo de nuevo.'));
      setStep('review');
    }
  };

  useBackClose(open, close, () => !busy);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !busy && close()} />
          <motion.div
            className="sheet import-sheet" role="dialog" aria-modal="true" aria-label={t('Importar extractos bancarios')}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 34, stiffness: 380 }}
          >
            <div className="grabber" />
            <div className="imp-head">
              <h2>{t('Importar extractos bancarios')}</h2>
              <button className="icon-btn" aria-label={t('Cerrar')} disabled={busy} onClick={close}><Icon name="x" size={20} /></button>
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
                      <small>{t('Para lo que las reglas no reconocen, se envían a Claude solo los nombres de esos comercios (sin IBAN ni emails; los pagos a personas no se envían). Si no los conoce, los busca en internet. Puede tardar algunos minutos.')}</small>
                    </span>
                  </label>
                )}
                {error && <p className="error" role="alert">{error}</p>}
              </>
            )}

            {step === 'analyzing' && (
              <Wait progress={progress} uploading={uploading} ai={opts.current.ai} onClose={close} onCancel={cancelAnalysis} />
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
                        <button type="button" className="btn" disabled={step === 'importing' || !last.current} onClick={() => { setAccount(preview.overlap!.account); reanalyze({ account: preview.overlap!.account, assume: false }); }}>{t('Es esa misma cuenta')}</button>
                        <button type="button" className="btn" disabled={step === 'importing' || !last.current} onClick={() => reanalyze({ assume: true })}>{t('Es otra cuenta distinta')}</button>
                      </div>
                    </div>
                  </div>
                )}
                {preview.overlap?.ignored && (
                  <p className="hint imp-range">{t('Se importará como una cuenta distinta de «{account}», aunque algunos movimientos se parezcan.', { account: accountName(preview.overlap.account) })}</p>
                )}
                {resumedFile && <p className="hint imp-range">{t('Este es el análisis de «{file}», que seguía en marcha en el servidor.', { file: resumedFile })}</p>}
                {preview.warnings.map((w) => <p key={w} className="imp-warn"><Icon name="info" size={16} />{w}</p>)}
                {cfg?.ai && (!preview.ai || !!preview.ai.problem) && lowRows.length > 0 && (
                  classifying
                    ? <Wait progress={progress} ai compact />
                    : (
                      <div className="imp-classify">
                        <button type="button" className="btn" disabled={step === 'importing'} onClick={classify}>{t('Identificar con IA {n} movimientos sin clasificar', { n: lowRows.length })}</button>
                        <small>{t('Envía a Claude solo los nombres de esos comercios y busca en internet los que no conoce. Puede tardar algunos minutos; lo que ya has corregido no se toca.')}</small>
                      </div>
                    )
                )}
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
                          <span className="imp-meta">{dayShort(r.date)} {r.date.slice(0, 4)}{r.skip && <em className="imp-tag">{skipLabel(r.skip)}</em>}{r.via === 'ai' && <em className="imp-tag imp-tag-ai" title={r.web ? t('Identificado por la IA buscando en internet') : t('Identificado por la IA')}>{r.web ? t('IA · web') : t('IA')}</em>}{r.hint && r.via === 'ai' && <span className="imp-hint"> {r.hint}</span>}</span>
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

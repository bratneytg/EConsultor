import type { CaptureInfo, CaptureItem } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useBackClose } from '../lib/backClose';
import { categoryLabel, expenseCategories, incomeCategories } from '../lib/categories';
import { dayShort, money, parseAmount } from '../lib/format';
import { t } from '../lib/i18n';
import { useCapture, useInvalidateData } from '../lib/queries';
import { Icon } from './Icon';
import { CatTile } from './ui';

interface Edit { categoryId?: string; amount?: string }

/** Pagos que llegaron del móvil y esperan confirmación: se elige la categoría y se añaden o se descartan. */
export function PendingSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { data } = useCapture(open);
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const items = data?.items ?? [];

  useEffect(() => { if (open) { setError(''); setConfirmAll(false); } }, [open]);
  useBackClose(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  // Al vaciarse la bandeja, la hoja se cierra sola.
  useEffect(() => { if (open && data && data.items.length === 0 && !busy) onClose(); }, [open, data, busy, onClose]);

  const set = (id: string, p: Edit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }));
  const refresh = async (info: CaptureInfo) => { qc.setQueryData(['capture'], info); await invalidate(); };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : t('No se pudo completar. Inténtalo de nuevo.')); } finally { setBusy(null); }
  };

  const accept = (it: CaptureItem) => run(it.id, async () => {
    const e = edits[it.id] ?? {};
    const body: Record<string, unknown> = {};
    if (e.categoryId && e.categoryId !== it.categoryId) body.categoryId = e.categoryId;
    if (it.foreign) {
      const minor = parseAmount(e.amount ?? '');
      if (!minor) throw new ApiError(400, 'foreign_amount', t('Escribe el importe en tu moneda para añadirlo.'));
      body.amountMinor = minor;
    }
    const r = await api<CaptureInfo & { transaction: unknown }>(`/capture/items/${it.id}/accept`, { method: 'POST', json: body });
    await refresh(r);
    onDone(it.test ? t('Prueba recibida: el móvil y el servidor se entienden.') : t('Añadido'));
  });
  const discard = (it: CaptureItem) => run(it.id, async () => { await refresh(await api<CaptureInfo>(`/capture/items/${it.id}`, { method: 'DELETE' })); });
  const acceptAll = () => run('all', async () => {
    const r = await api<CaptureInfo & { added: number }>('/capture/items/accept-all', { method: 'POST' });
    await refresh(r);
    onDone(r.added === 1 ? t('1 pago añadido') : t('{n} pagos añadidos', { n: r.added }));
  });
  const discardAll = () => run('all', async () => {
    await refresh(await api<CaptureInfo>('/capture/items/all', { method: 'DELETE' }));
    setConfirmAll(false);
  });

  const addable = items.filter((i) => !i.foreign && !i.test).length;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet" role="dialog" aria-modal="true" aria-label={t('Pagos pendientes')}
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.22 }}
          >
            <div className="grabber" />
            <h2 className="sheet-title">{t('Pagos pendientes')}</h2>
            <p className="muted" style={{ margin: '4px 0 14px', fontSize: 14 }}>{t('Llegaron desde tu móvil y no estaba clara su categoría. Revísalos y añádelos.')}</p>
            <div className="pending-list">
              {items.map((it) => {
                const e = edits[it.id] ?? {};
                const cat = e.categoryId ?? it.categoryId;
                const cats = it.type === 'income' ? incomeCategories([cat]) : expenseCategories([cat]);
                const sign = it.type === 'income' ? '+' : '−';
                return (
                  <div className="pending-item" key={it.id}>
                    <div className="pending-top">
                      <CatTile id={cat} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="t">{it.merchant}{it.test && <span className="tag">{t('Prueba')}</span>}</div>
                        <div className="c">{dayShort(it.at.slice(0, 10))}{it.from ? ` · ${it.from}` : ''}{it.hint ? ` · ${it.hint}` : ''}</div>
                      </div>
                      <div className={`a num ${it.type === 'income' ? 'in' : ''}`}>{sign}{money(it.amountMinor, it.currency)}</div>
                    </div>
                    {!it.test && (
                      <select className="input" aria-label={t('Categoría de {name}', { name: it.merchant })} value={cat} onChange={(ev) => set(it.id, { categoryId: ev.target.value })}>
                        {cats.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}
                      </select>
                    )}
                    {it.foreign && (
                      <div className="field" style={{ margin: '8px 0 0' }}>
                        <label htmlFor={`fa-${it.id}`}>{t('Importe en tu moneda')}</label>
                        <input id={`fa-${it.id}`} className="input" inputMode="decimal" placeholder="0,00" value={e.amount ?? ''} onChange={(ev) => set(it.id, { amount: ev.target.value })} />
                        <span className="hint">{t('Este pago está en {cur}: escribe cuánto te ha cobrado el banco en tu moneda.', { cur: it.currency })}</span>
                      </div>
                    )}
                    <div className="pending-actions">
                      <button className="btn btn-primary" disabled={busy !== null} onClick={() => accept(it)}><Icon name="check" size={18} />{it.test ? t('Entendido') : t('Añadir')}</button>
                      {!it.test && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => discard(it)}>{t('Descartar')}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            {items.length > 1 && (
              <div className="sheet-actions">
                {addable > 1 && <button className="btn" disabled={busy !== null} onClick={acceptAll}>{t('Añadir todos con la categoría propuesta')}</button>}
                {confirmAll
                  ? <button className="btn btn-ghost" disabled={busy !== null} onClick={discardAll}>{t('Sí, descartar todos')}</button>
                  : <button className="btn btn-ghost" onClick={() => setConfirmAll(true)}>{t('Descartar todos')}</button>}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

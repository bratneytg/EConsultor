import type { Transaction } from '@econsultor/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useUser } from '../lib/auth';
import { categoryColor, categoryLabel, expenseCategories, incomeCategories } from '../lib/categories';
import { ApiError } from '../lib/api';
import { addDays, isoToday, parseAmount, shiftMonth, symbol } from '../lib/format';
import { t } from '../lib/i18n';
import { useAccounts, useDeleteTransaction, useSaveRecurring, useSaveTransaction } from '../lib/queries';
import { Switch } from './ui';
import { Icon, CATEGORY_ICON } from './Icon';

interface Props {
  open: boolean;
  editing?: Transaction | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function AddSheet({ open, editing, onClose, onDone }: Props) {
  const user = useUser();
  const today = isoToday(user.timezone);
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState<string>('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [account, setAccount] = useState('');
  const [repeat, setRepeat] = useState(false);
  const { data: accounts } = useAccounts(open);
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const save = useSaveTransaction();
  const saveRecurring = useSaveRecurring();
  const del = useDeleteTransaction();

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setType(editing.type);
      setAmount((editing.amountMinor / 100).toFixed(2).replace('.', ','));
      setCat(editing.categoryId);
      setDate(editing.date);
      setNote(editing.note ?? '');
      setAccount(editing.account ?? '');
      setRepeat(false);
    } else {
      setType('expense'); setAmount(''); setCat(''); setDate(isoToday(user.timezone)); setNote(''); setAccount(''); setRepeat(false);
    }
    const timer = setTimeout(() => amountRef.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [open, editing, user.timezone]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cats = type === 'expense' ? expenseCategories(editing ? [editing.categoryId] : []) : incomeCategories(editing ? [editing.categoryId] : []);

  const submit = async (another: boolean) => {
    const minor = parseAmount(amount);
    if (!minor) return setError(t('Escribe un importe válido, por ejemplo 12,50'));
    if (!cat) return setError(t('Elige una categoría'));
    setError('');
    try {
      await save.mutateAsync({ id: editing?.id, data: { type, amountMinor: minor, categoryId: cat, date, note: note.trim() || undefined, account: account.trim() } });
      let repeated = false;
      if (repeat && !editing) {
        // Este movimiento ya está guardado: el periódico empieza el mes siguiente, el mismo día.
        try {
          await saveRecurring.mutateAsync({ data: { type, name: note.trim() || categoryLabel(cat), amountMinor: minor, categoryId: cat, day: Number(date.slice(8, 10)), startMonth: shiftMonth(date.slice(0, 7), 1), account: account.trim() || undefined } });
          repeated = true;
        } catch { /* el movimiento ya se guardó; se avisa abajo */ }
      }
      onDone(editing ? t('Cambios guardados') : repeat ? (repeated ? t('Guardado. Se repetirá cada mes.') : t('Guardado, pero no se pudo repetir cada mes.')) : type === 'expense' ? t('Gasto guardado') : t('Ingreso guardado'));
      if (another && !editing) { setAmount(''); setNote(''); setCat(''); setRepeat(false); amountRef.current?.focus(); } else onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo guardar. Inténtalo de nuevo.'));
    }
  };

  const remove = async () => {
    if (!editing) return;
    await del.mutateAsync(editing.id);
    onDone(t('Movimiento eliminado'));
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet" role="dialog" aria-modal="true" aria-label={editing ? t('Editar movimiento') : t('Anotar movimiento')}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 34, stiffness: 380 }}
          >
            <div className="grabber" />
            <div className="segmented" role="group" aria-label={t('Tipo de movimiento')}>
              <button aria-pressed={type === 'expense'} onClick={() => { setType('expense'); setCat(''); }}>{t('Gasto')}</button>
              <button aria-pressed={type === 'income'} onClick={() => { setType('income'); setCat(''); }}>{t('Ingreso')}</button>
            </div>

            <div className="amount-wrap">
              <input
                ref={amountRef} className="amount-input num" inputMode="decimal" autoComplete="off" placeholder="0,00"
                aria-label={t('Importe')} style={{ width: `${Math.max(3.2, amount.length * 0.62 + 0.4)}em` }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && submit(false)}
              />
              <span className="amount-cur">{symbol(user.currency)}</span>
            </div>

            <div className="cat-grid" role="group" aria-label={t('Categoría')}>
              {cats.map((c) => (
                <button key={c.id} className="cat" aria-pressed={cat === c.id} style={{ ['--tile-c' as string]: categoryColor(c.id) }} onClick={() => setCat(c.id)}>
                  <span className="tile"><Icon name={CATEGORY_ICON[c.id] ?? 'dots'} /></span>
                  {categoryLabel(c.id)}
                </button>
              ))}
            </div>

            <div className="field">
              <span className="lbl">{t('Fecha')}</span>
              <div className="pills">
                <button className="pill" aria-pressed={date === today} onClick={() => setDate(today)}>{t('Hoy')}</button>
                <button className="pill" aria-pressed={date === addDays(today, -1)} onClick={() => setDate(addDays(today, -1))}>{t('Ayer')}</button>
                <input className="input" type="date" aria-label={t('Otra fecha')} style={{ width: 'auto', padding: '6px 12px', borderRadius: 999 }} max={addDays(today, 1)} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="note">{t('Nota (opcional)')}</label>
              <input id="note" className="input" maxLength={200} placeholder={t('Ej.: compra semanal')} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {!editing && (
              <div className="setting" style={{ padding: '4px 0 12px', borderBottom: 0 }}>
                <div><b>{t('Repetir cada mes')}</b><p>{t('Se anotará solo el día {day} de cada mes.', { day: Number(date.slice(8, 10)) })}</p></div>
                <Switch label={t('Repetir cada mes')} checked={repeat} onChange={setRepeat} />
              </div>
            )}

            {((accounts?.length ?? 0) > 0 || account) && (
              <div className="field">
                <label htmlFor="account">{t('Cuenta (opcional)')}</label>
                <input id="account" className="input" maxLength={40} list="account-list" placeholder={t('Cuenta principal')} value={account} onChange={(e) => setAccount(e.target.value)} />
                <datalist id="account-list">{accounts?.filter((a) => a.name).map((a) => <option key={a.name} value={a.name} />)}</datalist>
              </div>
            )}

            <div className="sheet-actions">
              {error && <p className="error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-block" disabled={save.isPending} onClick={() => submit(false)}>{editing ? t('Guardar cambios') : t('Guardar')}</button>
              {!editing && <button className="btn btn-block" disabled={save.isPending} onClick={() => submit(true)}>{t('Guardar y añadir otro')}</button>}
              {editing && <button className="btn btn-danger btn-block" onClick={remove}><Icon name="trash" size={18} />{t('Eliminar movimiento')}</button>}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

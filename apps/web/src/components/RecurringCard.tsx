import type { Recurring } from '@econsultor/shared';
import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useUser } from '../lib/auth';
import { categoryLabel, expenseCategories, incomeCategories } from '../lib/categories';
import { dayShort, isoToday, money, parseAmount, shiftMonth, symbol } from '../lib/format';
import { t } from '../lib/i18n';
import { useDeleteRecurring, useRecurring, useSaveRecurring } from '../lib/queries';
import { CatTile, Card, Switch } from './ui';
import { Icon } from './Icon';
import { useShell } from './Shell';

interface Draft {
  id?: string;
  type: 'expense' | 'income';
  name: string;
  amount: string;
  categoryId: string;
  day: string;
  start: 'this' | 'next';
  endMonth: string;
  active: boolean;
}

/** Gastos e ingresos que se repiten cada mes: la app los anota sola el día elegido. */
export function RecurringCard() {
  const user = useUser();
  const { toast } = useShell();
  const { data: items } = useRecurring();
  const save = useSaveRecurring();
  const del = useDeleteRecurring();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const today = isoToday(user.timezone);
  const todayDay = Number(today.slice(8, 10));

  const blank = (): Draft => ({ type: 'expense', name: '', amount: '', categoryId: '', day: '1', start: 'next', endMonth: '', active: true });
  const fromRecurring = (r: Recurring): Draft => ({
    id: r.id, type: r.type, name: r.name, amount: (r.amountMinor / 100).toFixed(2).replace('.', ','), categoryId: r.categoryId,
    day: String(r.day), start: 'this', endMonth: r.endMonth ?? '', active: r.active,
  });
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  // Si el día aún no ha llegado este mes, empieza este mes; si ya pasó, el que viene.
  const defaultStart = (day: number): 'this' | 'next' => (day > todayDay ? 'this' : 'next');

  const submit = async () => {
    if (!draft) return;
    const minor = parseAmount(draft.amount);
    const day = Number(draft.day);
    if (!draft.name.trim()) return setError(t('Escribe un nombre, por ejemplo Alquiler'));
    if (!minor) return setError(t('Escribe un importe válido, por ejemplo 12,50'));
    if (!draft.categoryId) return setError(t('Elige una categoría'));
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError(t('El día debe estar entre 1 y 31'));
    setError('');
    const thisMonth = today.slice(0, 7);
    try {
      await save.mutateAsync({
        id: draft.id,
        data: {
          type: draft.type, name: draft.name.trim(), amountMinor: minor, categoryId: draft.categoryId, day,
          ...(draft.id ? {} : { startMonth: draft.start === 'this' ? thisMonth : shiftMonth(thisMonth, 1) }),
          endMonth: draft.endMonth || null,
          active: draft.active,
        },
      });
      toast(draft.id ? t('Cambios guardados') : t('Periódico guardado'));
      setDraft(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo guardar. Inténtalo de nuevo.'));
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    await del.mutateAsync(draft.id);
    toast(t('Periódico eliminado'));
    setDraft(null);
  };

  const cats = draft ? (draft.type === 'expense' ? expenseCategories([draft.categoryId]) : incomeCategories([draft.categoryId])) : [];

  return (
    <Card title={t('Gastos periódicos')} subtitle={t('Alquiler, transporte, Netflix, nómina… Se anotan solos cada mes, el día que elijas.')}>
      {(items ?? []).map((r) => (
        <div className="setting" key={r.id} style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
            <CatTile id={r.categoryId} />
            <div style={{ minWidth: 0 }}>
              <b>{r.name}</b>
              <p>
                {t('Cada mes, el día {day}', { day: r.day })} · {categoryLabel(r.categoryId)}
                {' · '}
                {!r.active ? t('En pausa') : r.nextDate ? t('Próximo: {date}', { date: dayShort(r.nextDate) }) : t('Terminado')}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="num" style={{ fontWeight: 600, color: r.type === 'income' ? 'var(--income)' : undefined }}>{r.type === 'income' ? '+' : ''}{money(r.amountMinor, user.currency)}</span>
            <button className="chip-btn" onClick={() => { setDraft(fromRecurring(r)); setError(''); }}>{t('Editar')}</button>
          </div>
        </div>
      ))}
      {items && items.length === 0 && !draft && <p className="hint" style={{ padding: '8px 0' }}>{t('Aún no tienes ninguno. Añade el alquiler o una suscripción y olvídate de anotarlo cada mes.')}</p>}

      {!draft && (
        <div style={{ paddingTop: 10 }}>
          <button className="btn" onClick={() => { const d = blank(); setDraft({ ...d, start: defaultStart(Number(d.day)) }); setError(''); }}><Icon name="repeat" size={18} />{t('Añadir periódico')}</button>
        </div>
      )}

      {draft && (
        <div className="stack" style={{ paddingTop: 12 }}>
          {!draft.id && (
            <div className="segmented" role="group" aria-label={t('Tipo de movimiento')}>
              <button aria-pressed={draft.type === 'expense'} onClick={() => set({ type: 'expense', categoryId: '' })}>{t('Gasto')}</button>
              <button aria-pressed={draft.type === 'income'} onClick={() => set({ type: 'income', categoryId: '' })}>{t('Ingreso')}</button>
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rc-name">{t('Nombre')}</label>
            <input id="rc-name" className="input" maxLength={60} placeholder={t('Ej.: Alquiler')} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rc-amount">{t('Importe')} ({symbol(user.currency)})</label>
            <input id="rc-amount" className="input num" inputMode="decimal" placeholder="0,00" value={draft.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,]/g, '') })} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rc-cat">{t('Categoría')}</label>
            <select id="rc-cat" className="input" value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">{t('Elige una categoría')}</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c.id)}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rc-day">{draft.type === 'income' ? t('Día de cobro') : t('Día del cargo')}</label>
            <input
              id="rc-day" className="input num" type="number" min={1} max={31} inputMode="numeric" value={draft.day}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); set(draft.id ? { day: v } : { day: v, start: defaultStart(Number(v)) }); }}
            />
            <span className="hint">{t('Si un mes tiene menos días, se anota el último.')}</span>
          </div>
          {!draft.id && (
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="lbl">{t('Empezar')}</span>
              <div className="pills">
                <button className="pill" aria-pressed={draft.start === 'this'} onClick={() => set({ start: 'this' })}>{t('Este mes')}</button>
                <button className="pill" aria-pressed={draft.start === 'next'} onClick={() => set({ start: 'next' })}>{t('El mes que viene')}</button>
              </div>
              {draft.start === 'this' && Number(draft.day) <= todayDay && <span className="hint">{t('El día ya ha pasado: se anotará ahora con la fecha de ese día.')}</span>}
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="rc-end">{t('Último mes (opcional)')}</label>
            <input id="rc-end" className="input" type="month" min={today.slice(0, 7)} value={draft.endMonth} onChange={(e) => set({ endMonth: e.target.value })} />
            <span className="hint">{t('Para cuotas o contratos que terminan. Vacío = sin fin.')}</span>
          </div>
          {draft.id && (
            <div className="setting" style={{ padding: '4px 0' }}>
              <div><b>{t('Activo')}</b><p>{t('En pausa no se anota nada; al reanudarlo no se anotan los meses de la pausa.')}</p></div>
              <Switch label={t('Activo')} checked={draft.active} onChange={(v) => set({ active: v })} />
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{draft.id ? t('Guardar cambios') : t('Guardar')}</button>
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>{t('Cancelar')}</button>
            {draft.id && <button className="btn btn-danger" onClick={remove}><Icon name="trash" size={18} />{t('Eliminar')}</button>}
          </div>
          {draft.id && <p className="hint">{t('Al eliminarlo se quedan los movimientos que ya anotó.')}</p>}
        </div>
      )}
    </Card>
  );
}

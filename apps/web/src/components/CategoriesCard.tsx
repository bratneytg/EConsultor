import { CATEGORIES, CATEGORY_LABEL_MAX, MAX_CUSTOM_CATEGORIES, categoryById, type CategoryPrefs, type CustomCategory, type PublicUser } from '@econsultor/shared';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { categoryLabel, categoryPrefs } from '../lib/categories';
import { t } from '../lib/i18n';
import { useInvalidateData } from '../lib/queries';
import { CatTile, Card, ColorPicker } from './ui';
import { Icon } from './Icon';
import { useShell } from './Shell';

type Kind = 'expense' | 'income';
type Nature = 'variable' | 'fixed' | 'discretionary';

interface Edit {
  /** Ausente = categoría nueva. */
  id?: string;
  label: string;
  family: string;
  nature: Nature;
}

const natureOf = (c: { fixed?: boolean; discretionary?: boolean }): Nature => (c.fixed ? 'fixed' : c.discretionary ? 'discretionary' : 'variable');

/** Categorías propias y nombres: crea las tuyas, cambia el nombre de las que hay y oculta las que no usas. */
export function CategoriesCard() {
  const user = useUser();
  const { setUser } = useAuth();
  const { toast } = useShell();
  const invalidate = useInvalidateData();
  const [kind, setKind] = useState<Kind>('expense');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const prefs = user.categoryPrefs;

  const serie = CATEGORIES.filter((c) => c.type === kind);
  const own = prefs.custom.filter((c) => c.type === kind);

  /** Guarda la personalización completa. Lo que se quita pasa a «Otros»; el servidor lo hace y refrescamos los datos. */
  const put = async (next: CategoryPrefs, message: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      setUser(await api<PublicUser>('/me/categories', { method: 'PUT', json: next }));
      await invalidate();
      toast(message);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('No se pudo guardar. Inténtalo de nuevo.'));
      return false;
    } finally { setBusy(false); }
  };
  const current = (): CategoryPrefs => categoryPrefs();

  const submit = async () => {
    if (!edit) return;
    const label = edit.label.trim();
    if (!label) return setError(t('Escribe un nombre'));
    const p = current();
    const flags = { fixed: edit.nature === 'fixed' || undefined, discretionary: edit.nature === 'discretionary' || undefined };
    let next: CategoryPrefs;
    if (!edit.id) {
      next = { ...p, custom: [...p.custom, { label, type: kind, family: kind === 'expense' ? (edit.family as CustomCategory['family']) : undefined, ...(kind === 'expense' ? flags : {}) } as CustomCategory] };
    } else if (edit.id.startsWith('c_')) {
      next = { ...p, custom: p.custom.map((c) => (c.id === edit.id ? { ...c, label, family: kind === 'expense' ? (edit.family as CustomCategory['family']) : c.family, ...(kind === 'expense' ? flags : {}) } : c)) };
    } else {
      // De serie: solo el nombre. Si queda igual que el original, se quita el cambio.
      const renamed = { ...p.renamed };
      if (label === t(categoryById(edit.id)?.label ?? edit.id)) delete renamed[edit.id];
      else renamed[edit.id] = label;
      next = { ...p, renamed };
    }
    if (await put(next, edit.id ? t('Cambios guardados') : t('Categoría creada'))) setEdit(null);
  };

  const remove = async (id: string) => {
    const p = current();
    if (await put({ ...p, custom: p.custom.filter((c) => c.id !== id) }, t('Categoría eliminada'))) setEdit(null);
  };

  const toggleHidden = async (id: string) => {
    const p = current();
    const hidden = p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id];
    await put({ ...p, hidden }, p.hidden.includes(id) ? t('Categoría visible') : t('Categoría oculta'));
  };

  const startEdit = (id: string): void => {
    const own = prefs.custom.find((c) => c.id === id);
    setEdit({ id, label: categoryLabel(id), family: own?.family ?? 'other', nature: own ? natureOf(own) : 'variable' });
    setError('');
  };
  const startNew = (): void => { setEdit({ label: '', family: 'other', nature: 'variable' }); setError(''); };

  const row = (id: string, custom: boolean) => {
    const hidden = prefs.hidden.includes(id);
    const canHide = !custom && id !== 'other_expense' && id !== 'other_income';
    return (
      <div className="setting" key={id} style={{ opacity: hidden ? 0.55 : 1 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <CatTile id={id} />
          <div style={{ minWidth: 0 }}>
            <b>{categoryLabel(id)}</b>
            {(custom || hidden || prefs.renamed[id]) && <p>{custom ? t('Creada por ti') : hidden ? t('Oculta al añadir movimientos') : t('Nombre cambiado')}</p>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="chip-btn" disabled={busy} onClick={() => startEdit(id)}>{t('Editar')}</button>
          {canHide && <button className="chip-btn" disabled={busy} onClick={() => toggleHidden(id)}>{hidden ? t('Mostrar') : t('Ocultar')}</button>}
        </div>
      </div>
    );
  };

  return (
    <Card title={t('Categorías')} subtitle={t('Crea las tuyas o cambia el nombre de las que hay. Lo que elimines pasa a «Otros».')}>
      <div className="segmented" role="group" aria-label={t('Tipo de movimiento')} style={{ marginBottom: 8 }}>
        <button aria-pressed={kind === 'expense'} onClick={() => { setKind('expense'); setEdit(null); }}>{t('Gastos')}</button>
        <button aria-pressed={kind === 'income'} onClick={() => { setKind('income'); setEdit(null); }}>{t('Ingresos')}</button>
      </div>

      {serie.map((c) => row(c.id, false))}
      {own.map((c) => row(c.id, true))}

      {!edit && prefs.custom.length < MAX_CUSTOM_CATEGORIES && (
        <div style={{ paddingTop: 10 }}>
          <button className="btn" onClick={startNew}><Icon name="plus" size={18} />{t('Nueva categoría')}</button>
        </div>
      )}

      {edit && (
        <div className="stack" style={{ paddingTop: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="cat-name">{edit.id ? t('Nombre') : t('Nombre de la categoría')}</label>
            <input id="cat-name" className="input" maxLength={CATEGORY_LABEL_MAX} placeholder={kind === 'expense' ? t('Ej.: Mascotas') : t('Ej.: Alquiler de una habitación')} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
          </div>
          {kind === 'expense' && (!edit.id || edit.id.startsWith('c_')) && (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <span className="lbl" id="cat-color-lbl">{t('Color')}</span>
                <ColorPicker label={t('Color')} value={edit.family} onChange={(family) => setEdit({ ...edit, family })} />
                <span className="hint">{t('Es el color con el que aparece en las gráficas.')}</span>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="cat-nature">{t('Tipo de gasto')}</label>
                <select id="cat-nature" className="input" value={edit.nature} onChange={(e) => setEdit({ ...edit, nature: e.target.value as Nature })}>
                  <option value="variable">{t('Variable: cambia de un mes a otro')}</option>
                  <option value="fixed">{t('Fijo: lo pagas todos los meses')}</option>
                  <option value="discretionary">{t('Discrecional: ocio y caprichos')}</option>
                </select>
                <span className="hint">{t('Los consejos y la previsión lo usan para separar lo que puedes recortar de lo que no.')}</span>
              </div>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy} onClick={submit}>{edit.id ? t('Guardar cambios') : t('Crear')}</button>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>{t('Cancelar')}</button>
            {edit.id?.startsWith('c_') && <button className="btn btn-danger" disabled={busy} onClick={() => remove(edit.id!)}><Icon name="trash" size={18} />{t('Eliminar')}</button>}
          </div>
          {edit.id?.startsWith('c_') && <p className="hint">{t('Sus movimientos pasarán a «Otros gastos» u «Otros ingresos».')}</p>}
        </div>
      )}
      {!edit && error && <p className="error" role="alert">{error}</p>}
    </Card>
  );
}

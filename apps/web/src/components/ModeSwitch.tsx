import type { PublicUser, UiMode } from '@econsultor/shared';
import { api } from '../lib/api';
import { useAuth, useUser } from '../lib/auth';
import { useShell } from './Shell';
import { t } from '../lib/i18n';

const MODES: [UiMode, string][] = [['simple', 'Sencilla'], ['pro', 'Profesional']];

/** Cambia entre la interfaz sencilla y la profesional; la elección se guarda en el perfil. */
export function ModeSwitch() {
  const user = useUser();
  const { setUser } = useAuth();
  const { toast } = useShell();

  const choose = async (uiMode: UiMode) => {
    if (uiMode === user.uiMode) return;
    setUser({ ...user, uiMode }); // optimista: la vista cambia al instante
    try {
      setUser(await api<PublicUser>('/me/settings', { method: 'PATCH', json: { uiMode } }));
    } catch {
      setUser(user);
      toast(t('No se pudo cambiar la interfaz'));
    }
  };

  return (
    <div className="segmented" role="group" aria-label={t('Tipo de interfaz')}>
      {MODES.map(([k, label]) => (
        <button key={k} aria-pressed={user.uiMode === k} onClick={() => choose(k)}>{label}</button>
      ))}
    </div>
  );
}

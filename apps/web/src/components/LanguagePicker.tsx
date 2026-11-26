import { LANGUAGES, type Lang } from '@econsultor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LANG_NAMES, t, useI18n } from '../lib/i18n';

/**
 * Selector de idioma. Cambia la interfaz al instante y, con sesión iniciada, lo guarda en la cuenta
 * (los textos que genera el servidor —consejos, avisos— usan el mismo idioma).
 */
export function LanguagePicker({ onSaved, compact }: { onSaved?: (u: unknown) => void; compact?: boolean }) {
  const { lang, setLang } = useI18n();
  const qc = useQueryClient();
  const { user } = useAuth();

  const change = async (next: Lang) => {
    setLang(next, true);
    if (!user) return; // pantalla de acceso: se guardará en la cuenta al entrar
    try {
      const user = await api('/me/settings', { method: 'PATCH', json: { language: next } });
      onSaved?.(user);
      await qc.invalidateQueries(); // consejos, informes… vuelven a pedirse en el idioma nuevo
    } catch { /* sin red: queda elegido en este dispositivo y se guarda en la cuenta al volver a entrar */ }
  };

  return (
    <label className={`lang-picker ${compact ? 'compact' : ''}`}>
      <span className={compact ? 'sr-only' : ''}>{t('Idioma')}</span>
      <select value={lang} onChange={(e) => void change(e.target.value as Lang)} aria-label={t('Idioma')}>
        {LANGUAGES.map((l) => <option key={l} value={l} lang={l}>{LANG_NAMES[l]}</option>)}
      </select>
    </label>
  );
}

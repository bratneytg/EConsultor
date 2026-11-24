export type ThemePref = 'system' | 'light' | 'dark';

export const getThemePref = (): ThemePref => {
  try { return (localStorage.getItem('econ-theme') as ThemePref) || 'system'; } catch { return 'system'; }
};

export function applyTheme(pref: ThemePref): void {
  try { localStorage.setItem('econ-theme', pref); } catch { /* modo privado */ }
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Si el usuario sigue al sistema, reacciona a cambios en vivo. */
export function watchSystemTheme(): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}

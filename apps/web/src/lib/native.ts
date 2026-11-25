/**
 * Puente con la app de Android (WebView). En el navegador `window.EConsultorAndroid` no existe y
 * todo esto es inofensivo. La app nativa programa el aviso diario con el reloj del sistema, así que
 * funciona aunque la web no esté abierta y sin depender de Web Push.
 */
interface AndroidBridge {
  setReminder(enabled: boolean, hhmm: string): void;
  appVersion(): string;
  setBars?(dark: boolean): void;
  saveTextFile?(name: string, mime: string, content: string): void;
}
declare global {
  interface Window { EConsultorAndroid?: AndroidBridge }
}

export const native = (): AndroidBridge | null => (typeof window !== 'undefined' ? window.EConsultorAndroid ?? null : null);
export const isAndroidApp = (): boolean => !!native();
export const platformName = (): string => (isAndroidApp() ? 'android' : isIOSWeb() ? 'ios-web' : 'web');
export const appVersion = (): string => { try { return native()?.appVersion() ?? 'web'; } catch { return 'web'; } };

function isIOSWeb(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function syncNativeReminder(enabled: boolean, time: string): void {
  try { native()?.setReminder(enabled, time); } catch { /* sin puente: nada que hacer */ }
}

/** Guarda un archivo de texto: en la app de Android va a Descargas; en el navegador, descarga normal. */
export function saveTextFile(name: string, mime: string, content: string): void {
  const n = native();
  if (n?.saveTextFile) { n.saveTextFile(name, mime, content); return; }
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

/** Mantiene las barras del sistema de Android a juego con el tema claro/oscuro de la web. */
export function watchNativeBars(): void {
  const n = native();
  if (!n?.setBars) return;
  const push = () => { try { n.setBars?.(document.documentElement.dataset.theme !== 'light'); } catch { /* sin puente */ } };
  push();
  new MutationObserver(push).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

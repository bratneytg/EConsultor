/**
 * Puente con la app de Android (WebView). En el navegador `window.EConsultorAndroid` no existe y
 * todo esto es inofensivo. La app nativa programa el aviso diario con el reloj del sistema, así que
 * funciona aunque la web no esté abierta y sin depender de Web Push.
 */
interface AndroidBridge {
  setReminder(enabled: boolean, hhmm: string): void;
  appVersion(): string;
  openExternal?(url: string): void;
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

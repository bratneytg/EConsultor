/**
 * Puente con la app de Android (WebView). En el navegador `window.EConsultorAndroid` no existe y
 * todo esto es inofensivo. La app nativa programa el aviso diario con el reloj del sistema, así que
 * funciona aunque la web no esté abierta y sin depender de Web Push.
 */
interface AndroidBridge {
  setReminder(enabled: boolean, hhmm: string): void;
  appVersion(): string;
  setBars?(dark: boolean): void;
  /** Mantiene la pantalla encendida (p. ej. mientras se analiza un extracto). Solo en versiones nuevas de la app. */
  keepScreenOn?(on: boolean): void;
  saveTextFile?(name: string, mime: string, content: string): void;
  /** Guarda un archivo binario (PDF) en Descargas; `base64` es su contenido. Solo en versiones nuevas de la app. */
  saveBinaryFile?(name: string, mime: string, base64: string): void;
  /** Huella nativa (BiometricPrompt + Keystore). Solo en versiones nuevas de la app. */
  biometricAvailable?(): boolean;
  biometricInfo?(): string;
  biometricEnroll?(cb: string, userId: string, id: string, secret: string, title: string, subtitle: string, cancel: string): void;
  biometricLogin?(cb: string, title: string, subtitle: string, cancel: string): void;
  biometricForget?(): void;
}
declare global {
  interface Window { EConsultorAndroid?: AndroidBridge; __ecBio?: (cb: string, ok: boolean, data: string) => void }
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

/** Guarda un archivo binario (el informe en PDF): en la app de Android va a Descargas; en el navegador, descarga normal. */
export async function saveBlobFile(name: string, blob: Blob): Promise<void> {
  const n = native();
  if (n?.saveBinaryFile) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    n.saveBinaryFile(name, blob.type || 'application/pdf', base64);
    return;
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Mantiene las barras del sistema de Android a juego con el tema claro/oscuro de la web. */
export function watchNativeBars(): void {
  const n = native();
  if (!n?.setBars) return;
  const push = () => { try { n.setBars?.(document.documentElement.dataset.theme !== 'light'); } catch { /* sin puente */ } };
  push();
  new MutationObserver(push).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// ───────── Huella nativa de la app de Android ─────────
// El WebView de Android no admite WebAuthn, así que la huella la gestiona la app (BiometricPrompt).

/** ¿Esta versión de la app sabe pedir la huella y el teléfono tiene una registrada? */
export function nativeBiometricAvailable(): boolean {
  try { return !!native()?.biometricAvailable?.(); } catch { return false; }
}
/** ¿La app es de una versión antigua, sin huella? (para avisar de que hay que actualizarla). */
export const nativeBiometricSupported = (): boolean => typeof native()?.biometricAvailable === 'function';

/** Datos no secretos del dispositivo ya activado: `{ userId, id }`, o null. */
export function nativeBiometricInfo(): { userId: string; id: string } | null {
  try {
    const raw = native()?.biometricInfo?.();
    const v = raw ? (JSON.parse(raw) as { userId?: string; id?: string }) : null;
    return v?.userId && v.id ? { userId: v.userId, id: v.id } : null;
  } catch { return null; }
}
export const nativeBiometricForget = (): void => { try { native()?.biometricForget?.(); } catch { /* nada */ } };

type Pending = { resolve: (data: string) => void; reject: (reason: string) => void };
const pending = new Map<string, Pending>();
function ensureCallback(): void {
  window.__ecBio = (cb, ok, data) => {
    const p = pending.get(cb);
    pending.delete(cb);
    if (p) ok ? p.resolve(data) : p.reject(data);
  };
}
function call(start: (cb: string) => void): Promise<string> {
  ensureCallback();
  const cb = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    pending.set(cb, { resolve, reject });
    try { start(cb); } catch (e) { pending.delete(cb); reject(String((e as Error)?.message ?? e)); }
  });
}
export interface BioText { title: string; subtitle: string; cancel: string }
/** Pide la huella y guarda el secreto protegido por ella. Rechaza con 'cancel' si la persona canceló. */
export const nativeBiometricEnroll = (userId: string, id: string, secret: string, tx: BioText): Promise<string> =>
  call((cb) => native()!.biometricEnroll!(cb, userId, id, secret, tx.title, tx.subtitle, tx.cancel));
/** Pide la huella y devuelve `{ userId, id, secret }` en JSON. */
export const nativeBiometricLogin = (tx: BioText): Promise<string> => call((cb) => native()!.biometricLogin!(cb, tx.title, tx.subtitle, tx.cancel));

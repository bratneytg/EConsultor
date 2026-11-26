import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { AuthResponse } from '@econsultor/shared';
import { api } from './api';
import { t } from './i18n';
import {
  isAndroidApp, nativeBiometricAvailable, nativeBiometricEnroll, nativeBiometricForget, nativeBiometricInfo, nativeBiometricLogin, nativeBiometricSupported,
  type BioText,
} from './native';

const FLAG = 'ec_passkey';

/** Marca de este dispositivo: la persona ya activó la huella aquí. */
export const deviceHasPasskey = (): boolean => {
  if (isAndroidApp()) return !!nativeBiometricInfo();
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
};
const setDeviceFlag = (on: boolean) => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch { /* sin almacenamiento */ } };
export const forgetDevicePasskey = () => { setDeviceFlag(false); if (isAndroidApp()) nativeBiometricForget(); };
/** Id de la huella activada en ESTE dispositivo (solo la app lo conoce), para marcarla en la lista. */
export const thisDeviceKeyId = (): string | undefined => (isAndroidApp() ? nativeBiometricInfo()?.id : undefined);

export type PasskeyStatus =
  | { ok: true; mode: 'native' | 'webauthn' }
  | { ok: false; reason: 'app_outdated' | 'no_biometrics' | 'no_webauthn' | 'insecure' | 'no_platform' };

/** Qué puede hacer este dispositivo, y si no puede, por qué (para explicarlo en vez de esconder la opción). */
export async function passkeyStatus(): Promise<PasskeyStatus> {
  if (isAndroidApp()) {
    if (!nativeBiometricSupported()) return { ok: false, reason: 'app_outdated' };
    return nativeBiometricAvailable() ? { ok: true, mode: 'native' } : { ok: false, reason: 'no_biometrics' };
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!browserSupportsWebAuthn()) return { ok: false, reason: 'no_webauthn' };
  try { return (await platformAuthenticatorIsAvailable()) ? { ok: true, mode: 'webauthn' } : { ok: false, reason: 'no_platform' }; } catch { return { ok: false, reason: 'no_platform' }; }
}

export const passkeysAvailable = async (): Promise<boolean> => (await passkeyStatus()).ok;

export function statusMessage(r: Exclude<PasskeyStatus, { ok: true }>['reason']): string {
  switch (r) {
    case 'app_outdated': return t('Esta versión de la app no admite la huella. Descarga la última versión de la app de Android e instálala encima.');
    case 'no_biometrics': return t('Este teléfono no tiene ninguna huella registrada. Añádela en Ajustes del teléfono › Seguridad y vuelve aquí.');
    case 'insecure': return t('La huella solo funciona con una dirección segura (https).');
    case 'no_webauthn': return t('Este navegador no admite entrar con huella.');
    default: return t('Este dispositivo no tiene huella, cara ni PIN configurados para iniciar sesión.');
  }
}

/** Traduce los fallos a mensajes comprensibles. Devuelve '' si la persona canceló. */
export function passkeyMessage(e: unknown): string {
  if (typeof e === 'string') {
    if (e === 'cancel') return '';
    if (e === 'invalidated') { forgetDevicePasskey(); return t('Cambiaste las huellas del teléfono, así que hay que volver a activarla en Ajustes › Seguridad.'); }
    if (e === 'none') return t('Aún no has activado la huella en este dispositivo. Entra con tu contraseña y actívala en Ajustes › Seguridad.');
    return t('No se pudo usar la huella.');
  }
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return '';
  if (name === 'InvalidStateError') return t('Este dispositivo ya está registrado.');
  if (name === 'NotSupportedError' || name === 'SecurityError') return t('Este dispositivo o navegador no permite usar la huella aquí.');
  return (e as Error)?.message || t('No se pudo usar la huella.');
}

const bioText = (kind: 'login' | 'enroll'): BioText => ({
  title: kind === 'login' ? t('Entrar en EConsultor') : t('Activar la huella'),
  subtitle: kind === 'login' ? t('Confirma con tu huella') : t('Confirma con tu huella para activar el acceso rápido'),
  cancel: t('Cancelar'),
});

export interface KeyRow { id: string; name: string; createdAt: string }

export async function registerPasskey(): Promise<KeyRow> {
  if (isAndroidApp()) {
    const r = await api<{ userId: string; id: string; secret: string; name: string; createdAt: string }>('/auth/passkey/biometric/register', { method: 'POST', json: {} });
    try {
      await nativeBiometricEnroll(r.userId, r.id, r.secret, bioText('enroll'));
    } catch (e) {
      // Si la huella no se llegó a guardar en el teléfono, el registro del servidor no sirve de nada: se retira.
      try { await api(`/auth/passkey/biometric/${encodeURIComponent(r.id)}`, { method: 'DELETE' }); } catch { /* ya se limpiará desde Ajustes */ }
      throw e;
    }
    return { id: r.id, name: r.name, createdAt: r.createdAt };
  }
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/passkey/register/options', { method: 'POST' });
  const response = await startRegistration({ optionsJSON });
  const r = await api<KeyRow>('/auth/passkey/register/verify', { method: 'POST', json: { response } });
  setDeviceFlag(true);
  return r;
}

export async function loginWithPasskey(): Promise<AuthResponse> {
  if (isAndroidApp()) {
    if (!nativeBiometricInfo()) throw 'none';
    const data = JSON.parse(await nativeBiometricLogin(bioText('login'))) as { userId: string; id: string; secret: string };
    return api<AuthResponse>('/auth/passkey/biometric/login', { method: 'POST', json: data });
  }
  const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/auth/passkey/login/options', { method: 'POST' });
  const response = await startAuthentication({ optionsJSON: options });
  return api<AuthResponse>('/auth/passkey/login/verify', { method: 'POST', json: { challengeId, response } });
}

/** Quita una huella de la cuenta (la ruta depende de si es una llave del navegador o la de la app). */
export async function removePasskey(id: string, kind: 'passkey' | 'app'): Promise<void> {
  await api(kind === 'app' ? `/auth/passkey/biometric/${encodeURIComponent(id)}` : `/auth/passkey/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (kind === 'app' && thisDeviceKeyId() === id) nativeBiometricForget();
}

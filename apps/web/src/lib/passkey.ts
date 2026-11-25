import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { AuthResponse } from '@econsultor/shared';
import { api } from './api';

const FLAG = 'ec_passkey';

/** Marca de este dispositivo: solo se ofrece «Entrar con huella» donde la persona ya la activó. */
export const deviceHasPasskey = (): boolean => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
const setDeviceFlag = (on: boolean) => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch { /* sin almacenamiento */ } };
export const forgetDevicePasskey = () => setDeviceFlag(false);

/** ¿Puede este dispositivo pedir huella/cara/PIN? (Chrome, Safari y PWA sí; la app de Android basada en WebView, según versión). */
export async function passkeysAvailable(): Promise<boolean> {
  try { return browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable()); } catch { return false; }
}

/** Traduce los fallos del navegador a mensajes comprensibles. Devuelve '' si la persona canceló. */
export function passkeyMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return '';
  if (name === 'InvalidStateError') return 'Este dispositivo ya está registrado.';
  if (name === 'NotSupportedError' || name === 'SecurityError') return 'Este dispositivo o navegador no permite usar la huella aquí.';
  return (e as Error)?.message || 'No se pudo usar la huella.';
}

export async function registerPasskey(): Promise<{ id: string; name: string; createdAt: string }> {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/auth/passkey/register/options', { method: 'POST' });
  const response = await startRegistration({ optionsJSON });
  const r = await api<{ id: string; name: string; createdAt: string }>('/auth/passkey/register/verify', { method: 'POST', json: { response } });
  setDeviceFlag(true);
  return r;
}

export async function loginWithPasskey(): Promise<AuthResponse> {
  const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/auth/passkey/login/options', { method: 'POST' });
  const response = await startAuthentication({ optionsJSON: options });
  return api<AuthResponse>('/auth/passkey/login/verify', { method: 'POST', json: { challengeId, response } });
}

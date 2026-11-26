import { ApiError, api } from './api';
import { t } from './i18n';

/**
 * Análisis de extractos en el servidor.
 *
 * El archivo se sube una vez; el servidor lo analiza por su cuenta (puede tardar minutos) y aquí solo se pregunta cómo va.
 * Así el móvil puede apagar la pantalla, cambiar de app o incluso cerrar la web: el id de la tarea queda guardado y,
 * al volver, se recoge el resultado. Todo error de red se tolera y se reintenta; solo un 404 (el servidor se reinició
 * y perdió la tarea) o un error de la propia tarea corta la espera.
 */

export interface JobProgress { stage: string; done: number; total: number }
export interface JobView<T> {
  id: string;
  kind: 'preview' | 'classify';
  status: 'running' | 'done' | 'error';
  progress: JobProgress;
  startedAt: number;
  result?: T;
  error?: { status: number; code: string; message: string };
}
export interface SavedJob { id: string; fileName: string; startedAt: number; ai: boolean; account: string }

const KEY = 'ec.importJob';
const MAX_AGE = 2 * 60 * 60_000;
const GIVE_UP = 30 * 60_000;

export function loadSavedJob(): SavedJob | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedJob | null;
    if (v && typeof v.id === 'string' && Date.now() - v.startedAt < MAX_AGE) return v;
  } catch { /* sin almacenamiento o dato roto */ }
  clearSavedJob();
  return null;
}
export function saveJob(j: SavedJob): void { try { localStorage.setItem(KEY, JSON.stringify(j)); } catch { /* sin almacenamiento */ } }
export function clearSavedJob(): void { try { localStorage.removeItem(KEY); } catch { /* nada */ } }

export const newKey = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

export class Aborted extends Error { constructor() { super('aborted'); } }

/** Espera `ms`, pero se adelanta si la app vuelve a primer plano o a tener red: justo entonces hay que preguntar. */
function nap(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const events: [EventTarget, string][] = [[document, 'visibilitychange'], [window, 'online'], [window, 'focus'], [window, 'pageshow']];
    const end = (err?: Aborted) => {
      clearTimeout(timer);
      for (const [target, name] of events) target.removeEventListener(name, wake);
      signal.removeEventListener('abort', abort);
      err ? reject(err) : resolve();
    };
    const wake = () => { if (document.visibilityState === 'visible') end(); };
    const abort = () => end(new Aborted());
    const timer = setTimeout(() => end(), ms);
    for (const [target, name] of events) target.addEventListener(name, wake);
    signal.addEventListener('abort', abort);
  });
}

const transient = (e: unknown): boolean => !(e instanceof ApiError) || e.status >= 500 || e.status === 0 || e.status === 408 || e.status === 429;

/** Sube el archivo creando la tarea. Con la misma clave, reintentar es seguro: el servidor no crea otra. */
export async function startJob<T>(path: '/import/jobs' | '/import/classify', json: Record<string, unknown>, signal: AbortSignal): Promise<JobView<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api<JobView<T>>(path, { method: 'POST', json, signal });
    } catch (e) {
      if (signal.aborted) throw new Aborted();
      if (!transient(e) || attempt >= 6) throw e;
      // Si la app está en segundo plano, se espera a que vuelva; si no, un respiro creciente.
      await nap(Math.min(1500 * (attempt + 1), 10_000), signal);
    }
  }
}

/** Pregunta por la tarea hasta que termina. Rechaza con el error de la tarea, con 404 si se perdió, o con `Aborted`. */
export async function waitJob<T>(id: string, opts: { signal: AbortSignal; onProgress?: (p: JobProgress) => void }): Promise<T> {
  let fails = 0;
  for (;;) {
    try {
      const j = await api<JobView<T>>(`/import/jobs/${id}`, { signal: opts.signal });
      fails = 0;
      if (j.status === 'done') return j.result as T;
      if (j.status === 'error') throw new ApiError(j.error?.status ?? 500, j.error?.code ?? 'error', j.error?.message ?? t('No se pudo analizar el archivo. Inténtalo de nuevo.'));
      opts.onProgress?.(j.progress);
      if (Date.now() - j.startedAt > GIVE_UP) throw new ApiError(504, 'timeout', t('El análisis está tardando demasiado. Vuelve a intentarlo con un archivo más pequeño.'));
    } catch (e) {
      if (opts.signal.aborted) throw new Aborted();
      if (!transient(e)) throw e;
      fails++;
    }
    await nap(fails ? Math.min(2000 * 2 ** Math.min(fails, 3), 15_000) : 2000, opts.signal);
  }
}

export const discardJob = (id: string): Promise<void> => api<void>(`/import/jobs/${id}`, { method: 'DELETE' }).catch(() => undefined);

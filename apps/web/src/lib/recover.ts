/**
 * Recuperación tras una actualización a medias. Cuando el servidor se reconstruye, los archivos de la versión
 * anterior (con otro nombre) desaparecen; una pestaña o una app instalada que aún los pide se queda en blanco.
 * Aquí se detecta ese fallo y se arregla solo: se borra la caché de la app y se recarga, una vez por minuto como mucho.
 */
const GUARD = 'ec_recover_at';

export const isChunkError = (e: unknown): boolean => {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Unable to preload CSS/i.test(msg);
};

/** Borra el service worker y las cachés y recarga. Devuelve false si ya se intentó hace poco (para no entrar en bucle). */
export async function recoverAndReload(force = false): Promise<boolean> {
  try {
    const last = Number(sessionStorage.getItem(GUARD) ?? 0);
    if (!force && Date.now() - last < 60_000) return false;
    sessionStorage.setItem(GUARD, String(Date.now()));
  } catch { /* sin almacenamiento: se intenta igualmente una vez */ }
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
  } catch { /* nada */ }
  window.location.reload();
  return true;
}

/** `import()` que se reintenta una vez y, si la versión ha cambiado, recarga la app para coger la nueva. */
export async function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (e1) {
    try {
      await new Promise((r) => setTimeout(r, 400));
      return await load();
    } catch (e2) {
      if (isChunkError(e2)) void recoverAndReload();
      throw e2;
    }
  }
}

/** Vite avisa con este evento cuando no puede cargar un trozo de la app. */
export function watchPreloadErrors(): void {
  window.addEventListener('vite:preloadError', (ev) => {
    ev.preventDefault();
    void recoverAndReload();
  });
}

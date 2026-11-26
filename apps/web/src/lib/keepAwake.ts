import { useEffect } from 'react';
import { native } from './native';

/**
 * Mientras `active`, intenta que la pantalla no se apague: Wake Lock en navegadores que lo tienen (Chrome, Safari 16.4+)
 * y la bandera de la ventana en la app de Android. Es un extra: el análisis sigue en el servidor aunque se apague.
 */
export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let lock: { release(): Promise<void> } | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        if (stopped || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
        lock = await navigator.wakeLock.request('screen');
      } catch { /* sin permiso o sin batería: no pasa nada */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    try { native()?.keepScreenOn?.(true); } catch { /* sin puente */ }
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
      try { native()?.keepScreenOn?.(false); } catch { /* sin puente */ }
    };
  }, [active]);
}

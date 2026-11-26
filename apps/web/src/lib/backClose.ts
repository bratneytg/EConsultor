import { useEffect, useRef } from 'react';

let seq = 0;

/**
 * Hace que el botón «Atrás» (el del móvil, el gesto de Android o el del navegador) cierre primero
 * una ventana abierta —hoja, aviso…— en vez de salir de la pantalla en la que estás.
 *
 * Al abrirse añade una entrada al historial; al pulsar Atrás esa entrada se retira y se cierra la ventana.
 * Si la ventana se cierra por otro camino (botón «Cerrar», tocar fuera, guardar), la entrada se retira sola.
 * `canClose` permite negarse a cerrar (por ejemplo, mientras se está importando): entonces la ventana sigue y Atrás no hace nada.
 */
export function useBackClose(open: boolean, onClose: () => void, canClose: () => boolean = () => true): void {
  const closeRef = useRef(onClose);
  const canRef = useRef(canClose);
  closeRef.current = onClose;
  canRef.current = canClose;

  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    const mark = () => history.pushState({ ...(history.state as object | null), ecSheet: id }, '');
    mark();
    let popped = false;
    const onPop = () => {
      if (!canRef.current()) { mark(); return; } // no se puede cerrar ahora: se vuelve a poner la entrada
      popped = true;
      window.removeEventListener('popstate', onPop);
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Cerrada por otro camino: se retira la entrada que añadimos (si sigue siendo la actual).
      if (!popped && (history.state as { ecSheet?: number } | null)?.ecSheet === id) history.back();
    };
  }, [open]);
}

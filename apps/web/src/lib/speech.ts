import { useCallback, useEffect, useRef, useState } from 'react';
import { getLang } from './i18n';

/** Reconocimiento de voz del navegador (Chrome, Edge, Safari). En el WebView de la app de Android no existe: se usa el dictado del teclado. */
interface Rec {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecCtor = new () => Rec;
const ctor = (): RecCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const LANGS = { es: 'es-ES', en: 'en-GB', it: 'it-IT', de: 'de-DE' } as const;

export type SpeechError = 'denied' | 'none' | 'other';

/** Dicta a texto. `onText` recibe lo que se lleva dicho (provisional mientras se habla y definitivo al terminar). */
export function useSpeech(onText: (text: string, final: boolean) => void, onError?: (e: SpeechError) => void) {
  const recRef = useRef<Rec | null>(null);
  const [listening, setListening] = useState(false);
  const supported = typeof window !== 'undefined' && ctor() !== null;
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* ya parado */ } }, []);
  const start = useCallback(() => {
    const C = ctor();
    if (!C || recRef.current) return;
    const r = new C();
    r.lang = LANGS[getLang()];
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let text = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) { text += e.results[i]![0]!.transcript; final = e.results[i]!.isFinal; }
      cb.current.onText(text.trim(), final);
    };
    r.onerror = (e) => cb.current.onError?.(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'none' : 'other');
    r.onend = () => { recRef.current = null; setListening(false); };
    recRef.current = r;
    try { r.start(); setListening(true); } catch { recRef.current = null; setListening(false); }
  }, []);
  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* nada */ } }, []);
  return { supported, listening, start, stop };
}

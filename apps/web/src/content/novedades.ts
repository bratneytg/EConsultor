import { tk } from '../lib/i18n';

/** Tipo de cambio: decide la etiqueta que se ve en la lista de novedades. */
export type ChangeKind = 'new' | 'feature' | 'improvement' | 'fix';
export interface Change { kind: ChangeKind; text: string }
export interface Release { version: string; title: string; changes: Change[] }

/**
 * Historial de versiones, la más reciente primero. Al subir `version` en apps/web/package.json hay que añadir aquí
 * una entrada con lo que ve la persona usuaria (sin jerga). Los textos pasan por `tk()` para que se traduzcan.
 */
export const RELEASES: Release[] = [
  {
    version: '1.2.0',
    title: tk('Idiomas, varias cuentas y más bancos'),
    changes: [
      { kind: 'new', text: tk('Idiomas: ahora puedes usar la app en inglés, español, italiano o alemán desde Ajustes.') },
      { kind: 'new', text: tk('Varias cuentas: importa el extracto de cada cuenta por separado y filtra tus movimientos por cuenta.') },
      { kind: 'feature', text: tk('Si subes por error un extracto que ya habías importado, te avisamos antes de duplicar nada.') },
      { kind: 'feature', text: tk('Aviso de novedades: verás aquí lo que cambia cada vez que la app se actualiza.') },
      { kind: 'improvement', text: tk('La importación reconoce muchos más bancos de Italia, Alemania y España, y también archivos de Excel y LibreOffice.') },
      { kind: 'improvement', text: tk('Mejor detección del tipo de gasto en comercios de Italia, Alemania y España.') },
      { kind: 'improvement', text: tk('El inicio es más limpio: hemos quitado el mapa de gasto.') },
      { kind: 'fix', text: tk('Los extractos de tarjetas como Nexi ya no aparecen como ingresos.') },
      { kind: 'fix', text: tk('La huella en la app de Android vuelve a funcionar: actívala en Ajustes › Seguridad.') },
    ],
  },
  {
    version: '1.1.0',
    title: tk('Seguridad y consejos'),
    changes: [
      { kind: 'feature', text: tk('Entra con huella o llave de acceso en lugar de la contraseña.') },
      { kind: 'feature', text: tk('Consejos detallados con un análisis más a fondo de tus gastos.') },
      { kind: 'improvement', text: tk('La sesión se cierra tras 10 minutos sin usar la app, salvo que elijas mantenerla abierta.') },
    ],
  },
];

export const KIND_LABEL: Record<ChangeKind, string> = {
  new: tk('Sección nueva'),
  feature: tk('Novedad'),
  improvement: tk('Mejora'),
  fix: tk('Corrección'),
};

/** Compara «1.10.0» con «1.9.0» como números, no como texto. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

const seenKey = (userId: string) => `ec_seen_version:${userId}`;
const NEW_ACCOUNT_MS = 30 * 60 * 1000;

/**
 * Qué versiones hay que enseñar ahora. Cuenta recién creada: ninguna (no tiene nada «nuevo»). Primera vez con esta
 * función: solo la última. Tras actualizar: todas las posteriores a la que ya vio (hasta 3).
 */
export function pendingReleases(userId: string, accountCreatedAt: string, current: string, now = Date.now()): Release[] {
  let seen: string | null = null;
  try { seen = localStorage.getItem(seenKey(userId)); } catch { /* sin almacenamiento */ }
  const upto = RELEASES.filter((r) => compareVersions(r.version, current) <= 0);
  if (!seen) {
    if (now - new Date(accountCreatedAt).getTime() < NEW_ACCOUNT_MS) { markSeen(userId, current); return []; }
    return upto.slice(0, 1);
  }
  return upto.filter((r) => compareVersions(r.version, seen!) > 0).slice(0, 3);
}

export function markSeen(userId: string, version: string): void {
  try { localStorage.setItem(seenKey(userId), version); } catch { /* sin almacenamiento */ }
}

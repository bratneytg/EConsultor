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
    version: '1.7.0',
    title: tk('Importar extractos: más inteligente y sin cortes'),
    changes: [
      { kind: 'improvement', text: tk('Reconoce muchos más comercios por sí solo: autobuses y trenes (Flix…), alquiler de esquís o coches, bares, tiendas pequeñas, peluquerías, talleres y servicios.') },
      { kind: 'new', text: tk('Con «Mejorar con IA», lo que sigue sin reconocerse se identifica por su nombre y, si hace falta, buscándolo en internet. Sale marcado con «IA» y una breve descripción para que lo revises.') },
      { kind: 'feature', text: tk('El análisis ya no se corta si apagas la pantalla o cambias de app: se hace en el servidor y lo recuperas al volver. Te avisamos de que puede tardar algunos minutos.') },
      { kind: 'feature', text: tk('Si lo subiste sin IA, puedes pedirla después solo para los movimientos sin clasificar, sin perder lo que ya corregiste.') },
    ],
  },
  {
    version: '1.6.0',
    title: tk('Conoce a Ian, tu asistente con IA'),
    changes: [
      { kind: 'new', text: tk('Ian, un asistente con IA incluido en Premium: le preguntas por tus gastos («¿en qué gasto más?», «¿cómo voy frente al mes pasado?») y te contesta con tus propios datos.') },
      { kind: 'feature', text: tk('Lo encuentras en Consejos, en «Hablar con Ian». La conversación no se guarda y verás cuántos mensajes te quedan hoy.') },
      { kind: 'improvement', text: tk('La página Premium, Ajustes y la Ayuda explican ahora qué incluye cada plan y qué datos recibe la IA en cada caso.') },
    ],
  },
  {
    version: '1.5.0',
    title: tk('Premium: la IA, por suscripción'),
    changes: [
      { kind: 'new', text: tk('Premium: consejos escritos por IA con tus comercios y tus hábitos, y análisis a fondo mejorado. Se paga cada mes y se cancela cuando quieras (Ajustes › Suscripción).') },
      { kind: 'improvement', text: tk('La cuenta gratuita ya no recorta los consejos: ves todo el análisis hecho en el servidor, sin límite de movimientos.') },
      { kind: 'feature', text: tk('Una página con lo que incluye cada plan y, en Ajustes, tu suscripción: próximo cobro, facturas, cambio de tarjeta y cancelación.') },
    ],
  },
  {
    version: '1.4.2',
    title: tk('Elegir el color de una categoría'),
    changes: [
      { kind: 'fix', text: tk('Al crear o editar una categoría ahora eliges el color tocando una muestra de color, en lugar de una lista de nombres.') },
    ],
  },
  {
    version: '1.4.1',
    title: tk('Ajustes más fáciles de recorrer'),
    changes: [
      { kind: 'improvement', text: tk('Ajustes ahora es un menú: cada tema (periódicos, categorías, seguridad…) tiene su propia pantalla.') },
      { kind: 'feature', text: tk('Puedes crear una categoría nueva al anotar un gasto o un ingreso, sin salir de esa ventana.') },
      { kind: 'fix', text: tk('El botón «Atrás» del móvil cierra primero la ventana abierta, en lugar de salir de la pantalla.') },
      { kind: 'fix', text: tk('Al cambiar de idioma, «Sencilla / Profesional» y el tema también se traducen.') },
    ],
  },
  {
    version: '1.4.0',
    title: tk('Gastos periódicos, categorías propias e informe en PDF'),
    changes: [
      { kind: 'new', text: tk('Gastos e ingresos periódicos: el alquiler, el transporte, Netflix o la nómina se anotan solos cada mes, el día que elijas (Ajustes › Gastos periódicos).') },
      { kind: 'new', text: tk('Informe mensual en PDF: un resumen escrito del mes, con lo que ha cambiado y qué hacer el siguiente, y todos tus gastos (Ajustes › Informe mensual).') },
      { kind: 'new', text: tk('Categorías propias: crea las tuyas, cambia el nombre de las que hay y oculta las que no uses (Ajustes › Categorías).') },
      { kind: 'feature', text: tk('«En qué se va» ahora se puede ver como barras o como tarta.') },
      { kind: 'feature', text: tk('Al anotar un movimiento puedes activar «Repetir cada mes».') },
    ],
  },
  {
    version: '1.3.0',
    title: tk('Filtros por categoría y PDF escaneados'),
    changes: [
      { kind: 'new', text: tk('Filtra tus movimientos por categoría, igual que al añadir un gasto o un ingreso. También puedes tocar una categoría en «En qué se va» para ver sus movimientos.') },
      { kind: 'feature', text: tk('Importa extractos en PDF que son solo una imagen (escaneados o capturas): la app los lee con OCR.') },
      { kind: 'feature', text: tk('Nueva categoría «Inversión y ahorro»: la importación reconoce compras en bolsa, ETF y cripto.') },
      { kind: 'improvement', text: tk('La importación reconoce mejor préstamos, operadoras de móvil e internet y transferencias.') },
      { kind: 'fix', text: tk('Ajustes ya no se queda en blanco tras una actualización: si una pantalla falla, la app se recupera o te ofrece recargar.') },
    ],
  },
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

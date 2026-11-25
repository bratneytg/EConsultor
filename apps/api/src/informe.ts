/**
 * Informes de solo lectura sobre la base de datos (archivo cifrado) para el administrador.
 *
 *   node dist/informe.js base           Estado de la base de datos
 *   node dist/informe.js actividad [N]  Qué ha pasado en los últimos N días (por defecto 7)
 *
 * No escribe nada, no abre el puerto de la app y NO muestra importes, notas ni contraseñas:
 * solo cifras, fechas, correos enmascarados y el registro de eventos de seguridad.
 */
import { readFileSync, statSync } from 'node:fs';
import { open } from './security/crypto.js';
import type { AuditEvent, PushSubscriptionRecord, SessionRecord, UserRecord } from './store/types.js';

interface Tx {
  userId: string;
  type: 'income' | 'expense';
  date: string;
  createdAt: string;
}
interface Snapshot {
  users: UserRecord[];
  sessions: SessionRecord[];
  transactions: Tx[];
  push: PushSubscriptionRecord[];
  audit: AuditEvent[];
}

const DAY = 86_400_000;
const AUDIT_LIMIT = 5000; // el archivo conserva como máximo los últimos 5000 eventos

// ───────── utilidades ─────────
const fmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const hora = (iso: string | number): string => fmt.format(new Date(iso)).replace(',', '');

function hace(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'hace menos de un minuto';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function enmascarar(email: string): string {
  const [local = '', dominio] = email.split('@');
  if (!dominio) return local.length <= 2 ? `${local}***` : `${local.slice(0, 2)}***`;
  return `${local.slice(0, 2)}***@${dominio}`;
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

function titulo(t: string): void {
  console.log(`\n${t}\n${'─'.repeat(t.length)}`);
}

// ───────── carga ─────────
function cargar(): { snap: Snapshot; file: string; cifrado: boolean; bytes: number; modificado: number } {
  const file = process.env.DATA_FILE ?? './data/store.json';
  let raw: string;
  let st;
  try {
    raw = readFileSync(file, 'utf8');
    st = statSync(file);
  } catch {
    console.error(`[ALERTA] No se encuentra el archivo de datos (${file}). ¿Está la app arrancada y el volumen montado?`);
    process.exit(2);
  }
  const trimmed = raw.trim();
  const cifrado = !trimmed.startsWith('{');
  let json = trimmed;
  if (cifrado) {
    const k = process.env.DATA_ENCRYPTION_KEY;
    if (!k) {
      console.error('[ALERTA] El archivo está cifrado y no hay DATA_ENCRYPTION_KEY en el entorno.');
      process.exit(2);
    }
    try {
      json = open(Buffer.from(k, 'base64'), trimmed).toString('utf8');
    } catch {
      console.error('[ALERTA] No se pudo descifrar el archivo: la clave no coincide. No se ha modificado nada.');
      process.exit(2);
    }
  }
  const snap = JSON.parse(json) as Snapshot;
  return {
    snap: {
      users: snap.users ?? [],
      sessions: snap.sessions ?? [],
      transactions: snap.transactions ?? [],
      push: snap.push ?? [],
      audit: snap.audit ?? [],
    },
    file,
    cifrado,
    bytes: st.size,
    modificado: st.mtimeMs,
  };
}

// ───────── informe: estado de la base de datos ─────────
function base(): void {
  const { snap, file, cifrado, bytes, modificado } = cargar();
  const ahora = Date.now();
  const { users, sessions, transactions, push, audit } = snap;

  titulo('BASE DE DATOS');
  console.log(`Archivo: ${file}`);
  console.log(`Tamaño: ${tamano(bytes)} · última escritura: ${hora(modificado)} (${hace(ahora - modificado)})`);
  console.log(
    cifrado
      ? '[OK] Está cifrado: sin la clave DATA_ENCRYPTION_KEY nadie puede leer su contenido.'
      : '[AVISO] El archivo NO está cifrado. Revisa DATA_ENCRYPTION_KEY y NODE_ENV=production.',
  );

  titulo('USUARIOS');
  const gratis = users.filter((u) => u.plan === 'free').length;
  const premium = users.length - gratis;
  console.log(`Cuentas en total: ${users.length} (${plural(gratis, 'gratuita', 'gratuitas')}, ${premium} de pago)`);
  const nuevos7 = users.filter((u) => ahora - Date.parse(u.createdAt) < 7 * DAY).length;
  console.log(`Creadas en los últimos 7 días: ${nuevos7}`);
  const con2fa = users.filter((u) => u.mfa?.enabled).length;
  console.log(`Con verificación en dos pasos: ${con2fa} de ${users.length}`);
  const bloqueadas = users.filter((u) => u.lockedUntil && u.lockedUntil > ahora).length;
  console.log(
    bloqueadas
      ? `[AVISO] Cuentas bloqueadas ahora mismo por intentos fallidos: ${bloqueadas}`
      : 'Cuentas bloqueadas ahora mismo por intentos fallidos: 0',
  );
  if (users.some((u) => u.email === 'admin')) {
    console.log(
      '[ALERTA] Existe la cuenta de pruebas «admin» (contraseña conocida). En el servidor real no debería existir: comprueba que ALLOW_DEMO_DATA=false y pide que la eliminen.',
    );
  }

  titulo('MOVIMIENTOS');
  const ingresos = transactions.filter((t) => t.type === 'income').length;
  console.log(
    `Total guardados: ${transactions.length} (${ingresos} ingresos, ${transactions.length - ingresos} gastos)`,
  );
  if (transactions.length) {
    const fechas = transactions.map((t) => t.date).sort();
    console.log(`Fechas que cubren: de ${fechas[0]} a ${fechas[fechas.length - 1]}`);
    const ult24 = transactions.filter((t) => ahora - Date.parse(t.createdAt) < DAY).length;
    console.log(`Añadidos en las últimas 24 horas: ${ult24}`);
    const conMov = new Set(transactions.map((t) => t.userId));
    console.log(`Usuarios con al menos un movimiento: ${conMov.size} de ${users.length}`);
  }

  titulo('CONEXIONES Y AVISOS');
  const activas = sessions.filter((s) => s.expiresAt > ahora && !s.revokedAt);
  console.log(`Sesiones abiertas ahora mismo: ${activas.length} (cada móvil u ordenador con sesión iniciada cuenta una)`);
  console.log(`Dispositivos con notificaciones activadas: ${push.length}`);
  console.log(`Eventos de seguridad guardados: ${audit.length} de un máximo de ${AUDIT_LIMIT} (se descartan los más antiguos)`);

  titulo('VALORACIÓN');
  const mb = bytes / 1024 / 1024;
  if (mb < 20) {
    console.log('[OK] El tamaño de los datos es pequeño: guardar y leer es instantáneo.');
  } else {
    console.log('[AVISO] El archivo ya es grande. Es buen momento de plantearse pasar a PostgreSQL.');
  }
  console.log('Orientación: con un archivo único y un solo servidor, es una opción válida mientras haya pocos usuarios.');
  console.log('Cuando la app tenga clientes de pago, lo recomendable es migrar a PostgreSQL con copias automáticas.');
}

// ───────── informe: actividad ─────────
const ETIQUETAS: Record<string, string> = {
  register: 'Cuenta nueva',
  login: 'Entrada correcta',
  login_failed: 'Intento de entrada fallido',
  mfa_failed: 'Código de dos pasos incorrecto',
  mfa_enabled: 'Activó la verificación en dos pasos',
  mfa_disabled: 'Desactivó la verificación en dos pasos',
  recovery_code_used: 'Usó un código de recuperación',
  refresh_reuse_detected: 'Sesión reutilizada (posible robo de sesión)',
  logout_all: 'Cerró todas sus sesiones',
  statement_import: 'Importó un extracto bancario',
};

function actividad(dias: number): void {
  const { snap } = cargar();
  const ahora = Date.now();
  const desde = ahora - dias * DAY;
  const porId = new Map(snap.users.map((u) => [u.id, u] as const));
  const quien = (id?: string): string => {
    if (!id) return '(desconocido)';
    const u = porId.get(id);
    return u ? enmascarar(u.email) : '(cuenta borrada)';
  };

  const eventos = snap.audit.filter((e) => Date.parse(e.at) >= desde).sort((a, b) => a.at.localeCompare(b.at));
  const cuenta = (t: string): number => eventos.filter((e) => e.type === t).length;

  titulo(`ACTIVIDAD DE LOS ÚLTIMOS ${plural(dias, 'DÍA', 'DÍAS')}`);
  console.log(`Desde ${hora(desde)} hasta ${hora(ahora)} (hora de Berlín)`);
  if (snap.audit.length >= AUDIT_LIMIT) {
    console.log('[AVISO] El registro está lleno: puede que falten eventos de los días más antiguos.');
  }

  titulo('RESUMEN');
  console.log(`Cuentas nuevas: ${cuenta('register')}`);
  console.log(`Entradas correctas: ${cuenta('login')}`);
  console.log(`Intentos de entrada fallidos: ${cuenta('login_failed') + cuenta('mfa_failed')}`);
  console.log(`Extractos importados: ${cuenta('statement_import')}`);
  const movimientos = snap.transactions.filter((t) => Date.parse(t.createdAt) >= desde).length;
  console.log(`Movimientos añadidos (a mano o por importación): ${movimientos}`);

  const nuevas = snap.users.filter((u) => Date.parse(u.createdAt) >= desde).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  titulo('USUARIOS NUEVOS');
  if (!nuevas.length) console.log('Ninguno en este periodo.');
  for (const u of nuevas) {
    const reg = eventos.find((e) => e.type === 'register' && e.userId === u.id);
    console.log(`${hora(u.createdAt)}  ${enmascarar(u.email)}  (${reg?.detail === 'google' ? 'con Google' : 'con correo y contraseña'})`);
  }

  titulo('AVISOS DE SEGURIDAD');
  let avisos = 0;
  const reuso = eventos.filter((e) => e.type === 'refresh_reuse_detected');
  for (const e of reuso) {
    avisos++;
    console.log(`[ALERTA] ${hora(e.at)} ${quien(e.userId)}: se reutilizó una sesión ya cerrada. Se revocó esa sesión; conviene avisar a la persona.`);
  }
  const fallosPorIp = new Map<string, number>();
  for (const e of eventos.filter((e) => e.type === 'login_failed' || e.type === 'mfa_failed')) {
    const ip = e.ip ?? '(sin IP)';
    fallosPorIp.set(ip, (fallosPorIp.get(ip) ?? 0) + 1);
  }
  for (const [ip, n] of [...fallosPorIp].sort((a, b) => b[1] - a[1])) {
    if (n >= 5) {
      avisos++;
      console.log(`[AVISO] ${n} intentos fallidos desde la dirección ${ip}. Si se repite, puede ser alguien probando contraseñas.`);
    }
  }
  const bloqueadas = snap.users.filter((u) => u.lockedUntil && u.lockedUntil > ahora);
  for (const u of bloqueadas) {
    avisos++;
    console.log(`[AVISO] ${enmascarar(u.email)} está bloqueada hasta ${hora(u.lockedUntil as number)} por intentos fallidos.`);
  }
  for (const e of eventos.filter((e) => e.type === 'recovery_code_used' || e.type === 'mfa_disabled')) {
    avisos++;
    console.log(`[AVISO] ${hora(e.at)} ${quien(e.userId)}: ${ETIQUETAS[e.type]}.`);
  }
  if (!avisos) console.log('[OK] Nada raro en este periodo.');

  titulo('IMPORTACIONES DE EXTRACTOS');
  const imp = eventos.filter((e) => e.type === 'statement_import');
  if (!imp.length) console.log('Ninguna en este periodo.');
  for (const e of imp) console.log(`${hora(e.at)}  ${quien(e.userId)}  ${e.detail ?? ''}`);

  titulo('ÚLTIMOS EVENTOS (los 25 más recientes)');
  const ultimos = eventos.slice(-25).reverse();
  if (!ultimos.length) console.log('Sin eventos en este periodo.');
  for (const e of ultimos) {
    const det = e.detail && e.type !== 'login_failed' ? ` · ${e.detail}` : '';
    console.log(`${hora(e.at)}  ${(ETIQUETAS[e.type] ?? e.type).padEnd(46)} ${quien(e.userId).padEnd(24)} ${e.ip ?? ''}${det}`);
  }
}

// ───────── entrada ─────────
const [, , orden = 'base', arg] = process.argv;
if (orden === 'base') base();
else if (orden === 'actividad') {
  const n = Number.parseInt(arg ?? '7', 10);
  actividad(Number.isFinite(n) && n > 0 && n <= 365 ? n : 7);
} else {
  console.error('Uso: node dist/informe.js base | actividad [días]');
  process.exit(1);
}

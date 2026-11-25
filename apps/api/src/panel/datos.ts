/**
 * Datos del panel personal de administración (solo lectura).
 *
 * Junta tres fuentes y devuelve un único objeto listo para dibujar:
 *   1. La base de datos cifrada (se descifra en memoria con DATA_ENCRYPTION_KEY, no se escribe nada).
 *   2. `host.json`: foto del servidor que deja el recolector (scripts/panel-recolector.py).
 *   3. `historial.jsonl`: una línea por minuto para los gráficos.
 *
 * Privacidad por defecto: se ven correos, IPs y eventos completos (es para administrar), pero NO los
 * importes ni las notas de los movimientos de otras personas. Se activan con PANEL_VER_IMPORTES=true.
 */
import { readFileSync, statSync } from 'node:fs';
import { open } from '../security/crypto.js';
import type { AuditEvent, PushSubscriptionRecord, SessionRecord, UserRecord } from '../store/types.js';

interface Tx {
  id: string;
  userId: string;
  type: 'income' | 'expense';
  date: string;
  categoryId: string;
  amountMinor: number;
  currency?: string;
  note?: string;
  createdAt: string;
}

export interface Instantanea {
  users: UserRecord[];
  sessions: SessionRecord[];
  transactions: Tx[];
  push: PushSubscriptionRecord[];
  audit: AuditEvent[];
}

export interface ArchivoBase {
  snap: Instantanea;
  ruta: string;
  bytes: number;
  modificado: number;
  cifrado: boolean;
}

export type Nivel = 'ok' | 'aviso' | 'alerta';
export interface Alerta {
  nivel: Exclude<Nivel, 'ok'>;
  titulo: string;
  detalle: string;
  donde: string;
}

export interface OpcionesPanel {
  archivoDatos: string;
  claveDatos?: Buffer;
  archivoHost: string;
  archivoHistorial: string;
  verImportes: boolean;
  puertoPanel: number;
  ahora?: number;
}

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const LIMITE_EVENTOS = 5000;

export const ETIQUETAS_EVENTO: Record<string, string> = {
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

type Grupo = 'entradas' | 'fallos' | 'altas' | 'seguridad';
const GRUPO_EVENTO: Record<string, Grupo> = {
  login: 'entradas',
  login_failed: 'fallos',
  mfa_failed: 'fallos',
  register: 'altas',
  statement_import: 'altas',
  mfa_enabled: 'seguridad',
  mfa_disabled: 'seguridad',
  recovery_code_used: 'seguridad',
  refresh_reuse_detected: 'seguridad',
  logout_all: 'seguridad',
};

const fechaBerlin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const diaDe = (t: number | string): string => fechaBerlin.format(new Date(t));

// ───────── lectura de la base de datos (con caché por fecha de modificación) ─────────
let cache: { clave: string; valor: ArchivoBase } | null = null;

export function leerBase(ruta: string, clave?: Buffer): ArchivoBase {
  const st = statSync(ruta);
  const id = `${ruta}:${st.mtimeMs}:${st.size}`;
  if (cache?.clave === id) return cache.valor;
  const crudo = readFileSync(ruta, 'utf8').trim();
  const cifrado = !crudo.startsWith('{');
  let json = crudo;
  if (cifrado) {
    if (!clave) throw new Error('El archivo está cifrado y falta DATA_ENCRYPTION_KEY.');
    try {
      json = open(clave, crudo).toString('utf8');
    } catch {
      throw new Error('No se pudo descifrar la base de datos: DATA_ENCRYPTION_KEY no coincide.');
    }
  }
  const s = JSON.parse(json) as Partial<Instantanea>;
  const valor: ArchivoBase = {
    snap: {
      users: s.users ?? [],
      sessions: s.sessions ?? [],
      transactions: s.transactions ?? [],
      push: s.push ?? [],
      audit: s.audit ?? [],
    },
    ruta,
    bytes: st.size,
    modificado: st.mtimeMs,
    cifrado,
  };
  cache = { clave: id, valor };
  return valor;
}

// ───────── lectura del recolector ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Libre = Record<string, any>;

function leerJson(ruta: string): Libre | null {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8')) as Libre;
  } catch {
    return null;
  }
}

interface Fila {
  t: number;
  carga?: number[];
  cpu?: number | null;
  mem?: number | null;
  disco?: number | null;
  temp?: number | null;
  app?: number;
  ms?: number | null;
  db?: number | null;
  rx?: number;
  tx?: number;
}

function leerHistorial(ruta: string): Fila[] {
  let texto = '';
  try {
    texto = readFileSync(ruta, 'utf8');
  } catch {
    return [];
  }
  const filas: Fila[] = [];
  for (const l of texto.split('\n')) {
    if (!l) continue;
    try {
      filas.push(JSON.parse(l) as Fila);
    } catch {
      /* línea incompleta: se ignora */
    }
  }
  return filas;
}

const media = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Agrupa filas (1/min) en cubos y devuelve puntos listos para dibujar. */
function resumirHistorial(filas: Fila[], desde: number, cubo: number): Libre[] {
  const cubos = new Map<number, Fila[]>();
  for (const f of filas) {
    if (f.t * 1000 < desde) continue;
    const k = Math.floor((f.t * 1000) / cubo) * cubo;
    (cubos.get(k) ?? cubos.set(k, []).get(k)!).push(f);
  }
  const claves = [...cubos.keys()].sort((a, b) => a - b);
  let previo: Fila | null = null;
  const salida: Libre[] = [];
  for (const k of claves) {
    const fs = cubos.get(k)!;
    const n = (campo: keyof Fila): number[] => fs.map((f) => f[campo]).filter((v): v is number => typeof v === 'number');
    const ultima = fs[fs.length - 1]!;
    // La red se guarda como contador acumulado: la velocidad es la diferencia entre cubos.
    let rx: number | null = null;
    let tx: number | null = null;
    if (previo && ultima.rx !== undefined && previo.rx !== undefined && ultima.rx >= previo.rx) {
      const seg = Math.max(1, ultima.t - previo.t);
      rx = (ultima.rx - previo.rx) / seg;
      tx = ((ultima.tx ?? 0) - (previo.tx ?? 0)) / seg;
    }
    previo = ultima;
    salida.push({
      t: k,
      cpu: media(n('cpu')),
      carga: media(fs.map((f) => f.carga?.[0]).filter((v): v is number => typeof v === 'number')),
      mem: media(n('mem')),
      disco: media(n('disco')),
      temp: n('temp').length ? Math.max(...n('temp')) : null,
      app: media(n('app')), // 1 = respondió siempre; 0 = nunca
      ms: media(n('ms')),
      db: n('db').length ? n('db')[n('db').length - 1] : null,
      rx,
      tx,
    });
  }
  return salida;
}

// ───────── construcción ─────────
export interface DatosPanel {
  generadoEn: number;
  verImportes: boolean;
  resumen: { nivel: Nivel; frase: string; alertas: Alerta[] };
  host: Libre | null;
  hostAntiguedadS: number | null;
  historial: { h24: Libre[]; d7: Libre[] };
  base: Libre | { error: string };
  usuarios: Libre[];
  movimientos: Libre;
  actividad: Libre;
}

const peor = (a: Nivel, b: Nivel): Nivel => (a === 'alerta' || b === 'alerta' ? 'alerta' : a === 'aviso' || b === 'aviso' ? 'aviso' : 'ok');

export function construirDatos(o: OpcionesPanel): DatosPanel {
  const ahora = o.ahora ?? Date.now();
  const alertas: Alerta[] = [];
  const avisar = (nivel: Alerta['nivel'], donde: string, titulo: string, detalle: string): void => {
    alertas.push({ nivel, donde, titulo, detalle });
  };

  // — recolector —
  const host = leerJson(o.archivoHost);
  const filas = leerHistorial(o.archivoHistorial);
  const hostAntiguedadS = host?.t ? Math.round(ahora / 1000 - host.t) : null;
  if (!host) {
    avisar('aviso', 'Servidor', 'Sin datos del servidor', 'No existe estado/host.json. Ejecuta «bash scripts/servidor.sh panel» para activar el recolector.');
  } else if (hostAntiguedadS !== null && hostAntiguedadS > 180) {
    avisar('aviso', 'Servidor', 'Los datos del servidor están desfasados', `La última lectura es de hace ${Math.round(hostAntiguedadS / 60)} min. Comprueba la tarea programada (crontab -l).`);
  }

  // — base de datos —
  let base: ArchivoBase | null = null;
  let errorBase: string | null = null;
  try {
    base = leerBase(o.archivoDatos, o.claveDatos);
  } catch (e) {
    errorBase = e instanceof Error ? e.message : String(e);
    avisar('alerta', 'Base de datos', 'No se puede leer la base de datos', errorBase);
  }

  const usuarios: Libre[] = [];
  let baseInfo: Libre | { error: string } = { error: errorBase ?? 'sin datos' };
  let movimientos: Libre = {};
  let actividad: Libre = {};

  if (base) {
    const { snap } = base;
    const porId = new Map(snap.users.map((u) => [u.id, u] as const));
    const email = (id?: string): string => (id ? porId.get(id)?.email ?? '(cuenta borrada)' : '(sin cuenta)');
    const sesionesActivas = snap.sessions.filter((s) => s.expiresAt > ahora && !s.revokedAt);

    const txPorUsuario = new Map<string, Tx[]>();
    for (const t of snap.transactions) (txPorUsuario.get(t.userId) ?? txPorUsuario.set(t.userId, []).get(t.userId)!).push(t);

    const ultimaEntrada = new Map<string, string>();
    const entradas30 = new Map<string, number>();
    for (const e of snap.audit) {
      if (e.type !== 'login' || !e.userId) continue;
      if (!ultimaEntrada.has(e.userId) || e.at > ultimaEntrada.get(e.userId)!) ultimaEntrada.set(e.userId, e.at);
      if (ahora - Date.parse(e.at) < 30 * DIA) entradas30.set(e.userId, (entradas30.get(e.userId) ?? 0) + 1);
    }

    for (const u of [...snap.users].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const txs = txPorUsuario.get(u.id) ?? [];
      const fila: Libre = {
        id: u.id.slice(0, 8),
        email: u.email,
        nombre: u.displayName,
        plan: u.plan,
        google: Boolean(u.googleSub),
        dosPasos: Boolean(u.mfa?.enabled),
        creada: u.createdAt,
        ultimaEntrada: ultimaEntrada.get(u.id) ?? null,
        entradas30d: entradas30.get(u.id) ?? 0,
        movimientos: txs.length,
        ultimoMovimiento: txs.length ? txs.reduce((m, t) => (t.createdAt > m ? t.createdAt : m), '') : null,
        sesiones: sesionesActivas.filter((s) => s.userId === u.id).length,
        dispositivosPush: snap.push.filter((p) => p.userId === u.id).length,
        intentosFallidos: u.failedLogins,
        bloqueadaHasta: u.lockedUntil && u.lockedUntil > ahora ? u.lockedUntil : null,
        zonaHoraria: u.timezone,
        moneda: u.currency,
        modo: u.uiMode ?? 'simple',
      };
      if (o.verImportes) {
        const tot: Record<string, { ingresos: number; gastos: number }> = {};
        for (const t of txs) {
          const m = (tot[t.currency ?? u.currency] ??= { ingresos: 0, gastos: 0 });
          if (t.type === 'income') m.ingresos += t.amountMinor;
          else m.gastos += t.amountMinor;
        }
        fila.importes = tot;
      }
      usuarios.push(fila);
    }

    const archivo = {
      ruta: base.ruta,
      bytes: base.bytes,
      modificado: base.modificado,
      cifrado: base.cifrado,
    };
    baseInfo = {
      archivo,
      cuentas: snap.users.length,
      gratuitas: snap.users.filter((u) => u.plan === 'free').length,
      depago: snap.users.filter((u) => u.plan !== 'free').length,
      conGoogle: snap.users.filter((u) => u.googleSub).length,
      conDosPasos: snap.users.filter((u) => u.mfa?.enabled).length,
      bloqueadas: snap.users.filter((u) => u.lockedUntil && u.lockedUntil > ahora).length,
      movimientos: snap.transactions.length,
      ingresos: snap.transactions.filter((t) => t.type === 'income').length,
      gastos: snap.transactions.filter((t) => t.type === 'expense').length,
      sesionesActivas: sesionesActivas.length,
      sesionesTotales: snap.sessions.length,
      dispositivosPush: snap.push.length,
      eventos: snap.audit.length,
      limiteEventos: LIMITE_EVENTOS,
    };

    // Movimientos: por día de alta (últimos 60 días), por usuario y por categoría. Importes solo con permiso.
    const hoy = diaDe(ahora);
    const dias: string[] = [];
    for (let i = 59; i >= 0; i--) dias.push(diaDe(ahora - i * DIA));
    const altasPorDia = new Map<string, number>(dias.map((d) => [d, 0]));
    for (const t of snap.transactions) {
      const d = diaDe(t.createdAt);
      if (altasPorDia.has(d)) altasPorDia.set(d, (altasPorDia.get(d) ?? 0) + 1);
    }
    const porCategoria = new Map<string, number>();
    for (const t of snap.transactions) porCategoria.set(t.categoryId, (porCategoria.get(t.categoryId) ?? 0) + 1);
    const fechas = snap.transactions.map((t) => t.date).sort();
    movimientos = {
      total: snap.transactions.length,
      desde: fechas[0] ?? null,
      hasta: fechas[fechas.length - 1] ?? null,
      hoy: altasPorDia.get(hoy) ?? 0,
      porDia: dias.map((d) => ({ dia: d, n: altasPorDia.get(d) ?? 0 })),
      porUsuario: usuarios.map((u) => ({ email: u.email, n: u.movimientos })).sort((a, b) => b.n - a.n),
      porCategoria: [...porCategoria].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
    };
    if (o.verImportes) {
      movimientos.ultimos = [...snap.transactions]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 40)
        .map((t) => ({
          alta: t.createdAt,
          fecha: t.date,
          email: email(t.userId),
          tipo: t.type,
          categoria: t.categoryId,
          importe: t.amountMinor,
          moneda: t.currency ?? 'EUR',
          nota: t.note ?? '',
        }));
    }

    // Actividad
    const eventos = [...snap.audit].sort((a, b) => b.at.localeCompare(a.at));
    const dias30: string[] = [];
    for (let i = 29; i >= 0; i--) dias30.push(diaDe(ahora - i * DIA));
    const porDia = new Map<string, Record<Grupo, number>>(dias30.map((d) => [d, { entradas: 0, fallos: 0, altas: 0, seguridad: 0 }]));
    for (const e of snap.audit) {
      const g = GRUPO_EVENTO[e.type];
      const fila = porDia.get(diaDe(e.at));
      if (g && fila) fila[g]++;
    }
    const porIp = new Map<string, { eventos: number; fallos: number; entradas: number; ultimo: string }>();
    for (const e of snap.audit) {
      if (!e.ip) continue;
      const r = porIp.get(e.ip) ?? { eventos: 0, fallos: 0, entradas: 0, ultimo: '' };
      r.eventos++;
      if (e.type === 'login_failed' || e.type === 'mfa_failed') r.fallos++;
      if (e.type === 'login') r.entradas++;
      if (e.at > r.ultimo) r.ultimo = e.at;
      porIp.set(e.ip, r);
    }
    actividad = {
      porDia: dias30.map((d) => ({ dia: d, ...porDia.get(d)! })),
      ips: [...porIp].map(([ip, r]) => ({ ip, ...r })).sort((a, b) => b.eventos - a.eventos).slice(0, 25),
      eventos: eventos.slice(0, 500).map((e) => ({
        at: e.at,
        tipo: e.type,
        etiqueta: ETIQUETAS_EVENTO[e.type] ?? e.type,
        email: email(e.userId),
        ip: e.ip ?? '',
        detalle: e.detail ?? '',
      })),
      totalEventos: snap.audit.length,
    };

    // — alertas de la base de datos —
    if (!base.cifrado) avisar('alerta', 'Base de datos', 'La base de datos NO está cifrada', 'Revisa DATA_ENCRYPTION_KEY y NODE_ENV=production en el archivo .env.');
    if (snap.users.some((u) => u.email === 'admin')) {
      avisar('alerta', 'Base de datos', 'Existe la cuenta de pruebas «admin»', 'Su contraseña es conocida. En el servidor real no debería existir: comprueba ALLOW_DEMO_DATA=false y elimínala.');
    }
    const reuso = snap.audit.filter((e) => e.type === 'refresh_reuse_detected' && ahora - Date.parse(e.at) < 7 * DIA);
    for (const e of reuso.slice(0, 3)) {
      avisar('alerta', 'Seguridad', 'Sesión reutilizada (posible robo)', `${email(e.userId)} · ${new Date(e.at).toISOString()}. Se revocó la sesión; conviene avisar a esa persona.`);
    }
    const fallos24 = new Map<string, number>();
    for (const e of snap.audit) {
      if ((e.type === 'login_failed' || e.type === 'mfa_failed') && ahora - Date.parse(e.at) < DIA) {
        const ip = e.ip ?? '(sin IP)';
        fallos24.set(ip, (fallos24.get(ip) ?? 0) + 1);
      }
    }
    for (const [ip, n] of fallos24) {
      if (n >= 5) avisar('aviso', 'Seguridad', `${n} intentos fallidos desde ${ip}`, 'En las últimas 24 horas. Si se repite, alguien puede estar probando contraseñas.');
    }
    for (const u of snap.users.filter((x) => x.lockedUntil && x.lockedUntil > ahora)) {
      avisar('aviso', 'Seguridad', `Cuenta bloqueada: ${u.email}`, 'Se bloqueó temporalmente por intentos fallidos.');
    }
    if (base.bytes > 20 * 1024 * 1024) avisar('aviso', 'Base de datos', 'El archivo ya es grande', 'Es buen momento de plantearse pasar a PostgreSQL.');
    if (snap.audit.length >= LIMITE_EVENTOS) avisar('aviso', 'Seguridad', 'El registro de eventos está lleno', 'Los eventos más antiguos se van descartando.');
  }

  // — alertas del servidor —
  if (host) {
    const sec = (k: string): Libre | null => (host[k] && !host[k].error ? host[k] : null);
    const mem = sec('memoria');
    if (mem) {
      if (mem.usada_pct >= 90) avisar('alerta', 'Servidor', `Memoria al ${Math.round(mem.usada_pct)}%`, 'Casi llena: el sistema empezará a cerrar programas.');
      else if (mem.usada_pct >= 85) avisar('aviso', 'Servidor', `Memoria al ${Math.round(mem.usada_pct)}%`, 'Va justa.');
    }
    for (const d of Array.isArray(host.discos) ? host.discos : []) {
      if (d.montaje !== '/') continue;
      if (d.pct >= 90) avisar('alerta', 'Servidor', `Disco lleno al ${d.pct}%`, 'Hay que liberar espacio ya.');
      else if (d.pct >= 80) avisar('aviso', 'Servidor', `Disco al ${d.pct}%`, 'Conviene revisar qué ocupa.');
    }
    const calor = Array.isArray(host.temperaturas) ? Math.max(0, ...host.temperaturas.map((t: Libre) => t.c as number)) : 0;
    if (calor >= 85) avisar('alerta', 'Servidor', `Temperatura de ${Math.round(calor)} °C`, 'Demasiado alta: revisa la ventilación del portátil.');
    else if (calor >= 75) avisar('aviso', 'Servidor', `Temperatura de ${Math.round(calor)} °C`, 'Algo alta.');
    const bat = host.bateria;
    if (bat && /discharg/i.test(bat.estado)) {
      avisar(bat.pct < 25 ? 'alerta' : 'aviso', 'Servidor', `Funcionando con batería (${bat.pct}%)`, 'Se ha ido la luz o el cargador está desconectado.');
    }
    if (host.sistema?.reinicio_pendiente) avisar('aviso', 'Servidor', 'El sistema pide reiniciar', 'Ejecuta «sudo reboot» cuando te venga bien.');
    const apt = host.lento?.apt;
    if (apt && !apt.error && apt.pendientes > 0) {
      avisar('aviso', 'Servidor', `${apt.pendientes} actualizaciones del sistema pendientes`, `${apt.seguridad} son de seguridad. «sudo apt update && sudo apt full-upgrade»`);
    }

    if (host.app && host.app.ok === false) avisar('alerta', 'La app', 'La app no responde', host.app.error ?? 'El comprobador /healthz no devolvió 200.');
    const docker = sec('docker');
    if (docker) {
      for (const c of docker.contenedores ?? []) {
        if (c.estado !== 'running') avisar('alerta', 'Contenedores', `${c.nombre} está ${c.estado}`, c.detalle ?? '');
        else if (c.salud && c.salud !== 'healthy' && c.salud !== 'sin comprobación') avisar('aviso', 'Contenedores', `${c.nombre}: salud «${c.salud}»`, 'Si acaba de arrancar, espera un minuto.');
        if ((c.reinicios ?? 0) >= 3) avisar('aviso', 'Contenedores', `${c.nombre} se ha reiniciado ${c.reinicios} veces`, 'Mira sus registros en la pestaña Contenedores.');
      }
    } else if (host.docker?.error) {
      avisar('alerta', 'Contenedores', 'No se puede consultar Docker', host.docker.error);
    }
    const git = sec('git');
    if (git?.cambios_locales > 0) avisar('aviso', 'La app', 'Hay cambios locales sin subir en el servidor', 'Pueden bloquear las actualizaciones automáticas.');

    const ts = sec('tailscale');
    if (ts) {
      if (ts.estado !== 'Running') avisar('alerta', 'Red', `Tailscale no está activo (${ts.estado})`, 'Sin Tailscale no hay acceso desde fuera.');
      for (const s of ts.serve ?? []) {
        if (s.publico && String(s.destino).includes(`:${o.puertoPanel}`)) {
          avisar('alerta', 'Red', 'EL PANEL ESTÁ ABIERTO A INTERNET', `El puerto ${s.puerto} está en Funnel y apunta al panel. Ciérralo ya: «bash scripts/servidor.sh panel».`);
        }
      }
    } else if (host.tailscale?.error) {
      avisar('aviso', 'Red', 'No se puede consultar Tailscale', String(host.tailscale.error));
    }
    for (const p of Array.isArray(host.puertos) ? host.puertos : []) {
      if (p.abierto_a_la_red && [host.puerto_app, host.puerto_panel].includes(p.puerto)) {
        avisar('alerta', 'Red', `El puerto ${p.puerto} escucha en toda la red local`, 'Debería estar solo en 127.0.0.1. Revisa docker-compose.yml.');
      }
    }

    const cop = host.lento?.copias;
    if (cop) {
      if (cop.error) avisar('aviso', 'Copias', 'Las copias de seguridad no están listas', cop.error);
      else if (!cop.instantaneas?.length) avisar('aviso', 'Copias', 'Todavía no hay ninguna copia', 'Ejecuta «bash scripts/servidor.sh copiar».');
      else {
        const horas = (ahora - Date.parse(cop.instantaneas[0].fecha)) / HORA;
        if (horas > 72) avisar('alerta', 'Copias', `La última copia es de hace ${Math.round(horas / 24)} días`, 'La tarea nocturna no está funcionando.');
        else if (horas > 36) avisar('aviso', 'Copias', `La última copia es de hace ${Math.round(horas)} h`, 'Debería hacerse una cada noche.');
      }
    }
  }

  const nivel = alertas.reduce<Nivel>((acc, a) => peor(acc, a.nivel), 'ok');
  const urgentes = alertas.filter((a) => a.nivel === 'alerta').length;
  const frase =
    nivel === 'ok'
      ? 'Todo en orden.'
      : urgentes
        ? urgentes === 1
          ? 'Hay 1 cosa urgente.'
          : `Hay ${urgentes} cosas urgentes.`
        : alertas.length === 1
          ? 'Hay 1 cosa que revisar.'
          : `Hay ${alertas.length} cosas que revisar.`;
  alertas.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'alerta' ? -1 : 1));

  return {
    generadoEn: ahora,
    verImportes: o.verImportes,
    resumen: { nivel, frase, alertas },
    host,
    hostAntiguedadS,
    historial: {
      h24: resumirHistorial(filas, ahora - DIA, 10 * MIN),
      d7: resumirHistorial(filas, ahora - 7 * DIA, HORA),
    },
    base: baseInfo,
    usuarios,
    movimientos,
    actividad,
  };
}

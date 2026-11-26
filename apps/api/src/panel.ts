/**
 * Panel personal de administración de EConsultor.
 *
 *   node dist/panel.js
 *
 * Un servidor web mínimo, SEPARADO de la app, que enseña en una sola página el estado del servidor y de
 * la base de datos. Lo único que puede cambiar es el plan (Premium/Gratis) de una cuenta, y no escribe
 * en la base de datos: se lo pide a la app, que es quien la gestiona. Sin ADMIN_TOKEN es de solo lectura.
 *
 * Seguridad (imprescindible: ve datos de todos los usuarios):
 *  - Escucha solo en el puerto 127.0.0.1:8788 del servidor (docker-compose) y se publica ÚNICAMENTE con
 *    `tailscale serve` (red privada). NUNCA con Funnel: el recolector lo vigila y lanza una alerta roja.
 *  - Contraseña propia (PANEL_PASSWORD), con bloqueo tras varios fallos seguidos.
 *  - Cookie de sesión HttpOnly + SameSite=Strict, que caduca a las 12 horas.
 *  - Cabeceras estrictas (CSP con nonce, sin recursos externos) y respuestas siempre sin caché.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { construirDatos, type OpcionesPanel } from './panel/datos.js';

export interface ConfigPanel {
  contrasena: string;
  puerto: number;
  host: string;
  datos: Omit<OpcionesPanel, 'ahora'>;
  /** Solo para pruebas: permite la cookie sin HTTPS. */
  cookieSegura: boolean;
  html: string;
  /** Para cambiar el plan de una cuenta el panel se lo pide a la app (red interna de Docker) con esta clave. */
  app?: { url: string; token: string };
}

const SESION_MS = 12 * 60 * 60 * 1000;
const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();
const iguales = (a: string, b: string): boolean => timingSafeEqual(sha(a), sha(b));

function cookies(req: IncomingMessage): Record<string, string> {
  const r: Record<string, string> = {};
  for (const par of (req.headers.cookie ?? '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) r[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return r;
}

function ipDe(req: IncomingMessage): string {
  // Solo se llega a este puerto por 127.0.0.1 (Tailscale Serve), así que X-Forwarded-For es de fiar.
  const xff = req.headers['x-forwarded-for'];
  const primera = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return primera || req.socket.remoteAddress || 'desconocida';
}

export function crearPanel(cfg: ConfigPanel) {
  const sesiones = new Map<string, number>();
  const fallos = new Map<string, { n: number; hasta: number }>();
  let fallosGlobales = { n: 0, hasta: 0 };

  const cabeceras = (nonce?: string): Record<string, string> => ({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(nonce
      ? {
          'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        }
      : { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }),
  });

  function json(res: ServerResponse, estado: number, cuerpo: unknown, extra: Record<string, string> = {}): void {
    res.writeHead(estado, { ...cabeceras(), 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(cuerpo));
  }

  const autenticado = (req: IncomingMessage): boolean => {
    const token = cookies(req).panel_sesion;
    if (!token) return false;
    const caduca = sesiones.get(token);
    if (!caduca) return false;
    if (caduca < Date.now()) {
      sesiones.delete(token);
      return false;
    }
    return true;
  };

  async function cuerpo(req: IncomingMessage): Promise<string> {
    const trozos: Buffer[] = [];
    let total = 0;
    for await (const t of req) {
      total += (t as Buffer).length;
      if (total > 4096) throw new Error('demasiado grande');
      trozos.push(t as Buffer);
    }
    return Buffer.concat(trozos).toString('utf8');
  }

  const servidor = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://panel.local');
      const ruta = url.pathname;

      if (ruta === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { ...cabeceras(), 'Content-Type': 'text/plain' });
        return void res.end('ok');
      }

      if (ruta === '/favicon.ico') {
        res.writeHead(204, cabeceras());
        return void res.end();
      }

      if (ruta === '/' && req.method === 'GET') {
        const nonce = randomBytes(16).toString('base64');
        res.writeHead(200, { ...cabeceras(nonce), 'Content-Type': 'text/html; charset=utf-8' });
        return void res.end(cfg.html.replaceAll('__NONCE__', nonce));
      }

      if (ruta === '/api/entrar' && req.method === 'POST') {
        const ip = ipDe(req);
        const ahora = Date.now();
        const f = fallos.get(ip) ?? { n: 0, hasta: 0 };
        if (f.hasta > ahora || fallosGlobales.hasta > ahora) {
          const seg = Math.ceil((Math.max(f.hasta, fallosGlobales.hasta) - ahora) / 1000);
          return json(res, 429, { error: `Demasiados intentos. Espera ${Math.ceil(seg / 60)} min.` }, { 'Retry-After': String(seg) });
        }
        let clave = '';
        try {
          clave = String((JSON.parse(await cuerpo(req)) as { clave?: unknown }).clave ?? '');
        } catch {
          return json(res, 400, { error: 'Petición no válida.' });
        }
        if (!iguales(clave, cfg.contrasena)) {
          f.n++;
          fallosGlobales.n++;
          if (f.n >= MAX_FALLOS) Object.assign(f, { n: 0, hasta: ahora + BLOQUEO_MS });
          if (fallosGlobales.n >= MAX_FALLOS * 3) fallosGlobales = { n: 0, hasta: ahora + BLOQUEO_MS };
          fallos.set(ip, f);
          console.warn(`[panel] contraseña incorrecta desde ${ip}`);
          return json(res, 401, { error: 'Contraseña incorrecta.' });
        }
        fallos.delete(ip);
        fallosGlobales.n = 0;
        const token = randomBytes(32).toString('base64url');
        sesiones.set(token, ahora + SESION_MS);
        for (const [t, c] of sesiones) if (c < ahora) sesiones.delete(t);
        console.log(`[panel] entrada desde ${ip}`);
        return json(res, 200, { ok: true }, {
          'Set-Cookie': `panel_sesion=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESION_MS / 1000}${cfg.cookieSegura ? '; Secure' : ''}`,
        });
      }

      if (ruta === '/api/salir' && req.method === 'POST') {
        const token = cookies(req).panel_sesion;
        if (token) sesiones.delete(token);
        return json(res, 200, { ok: true }, {
          'Set-Cookie': `panel_sesion=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.cookieSegura ? '; Secure' : ''}`,
        });
      }

      if (ruta === '/api/datos' && req.method === 'GET') {
        if (!autenticado(req)) return json(res, 401, { error: 'Sesión no iniciada.' });
        const usuarioTailscale = req.headers['tailscale-user-login'];
        const datos = construirDatos({ ...cfg.datos, puedeCambiarPlan: !!cfg.app });
        return json(res, 200, { ...datos, conectadoComo: Array.isArray(usuarioTailscale) ? usuarioTailscale[0] : usuarioTailscale ?? null });
      }

      if (ruta === '/api/plan' && req.method === 'POST') {
        if (!autenticado(req)) return json(res, 401, { error: 'Sesión no iniciada.' });
        // Defensa extra contra peticiones desde otras webs: solo el JS del propio panel manda esta cabecera.
        if (req.headers['x-panel'] !== '1') return json(res, 400, { error: 'Petición no válida.' });
        if (!cfg.app) return json(res, 409, { error: 'El panel no está enlazado con la app. Ejecuta: bash scripts/servidor.sh panel' });
        let datos: { email?: unknown; plan?: unknown } = {};
        try { datos = JSON.parse(await cuerpo(req)) as typeof datos; } catch { return json(res, 400, { error: 'Petición no válida.' }); }
        if (typeof datos.email !== 'string' || !datos.email || (datos.plan !== 'free' && datos.plan !== 'premium' && datos.plan !== 'auto')) {
          return json(res, 400, { error: 'Petición no válida.' });
        }
        try {
          const r = await fetch(`${cfg.app.url}/api/admin/plan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-admin-token': cfg.app.token },
            body: JSON.stringify({ email: datos.email, plan: datos.plan }),
            signal: AbortSignal.timeout(8000),
          });
          const salida = (await r.json().catch(() => ({}))) as { error?: string };
          if (!r.ok) {
            console.warn(`[panel] cambio de plan rechazado por la app (${r.status})`);
            return json(res, r.status === 401 ? 502 : r.status, { error: r.status === 401 ? 'La app no acepta la clave del panel. Ejecuta: bash scripts/servidor.sh panel' : salida.error ?? 'La app no pudo cambiar el plan.' });
          }
          console.log(`[panel] plan de una cuenta cambiado a ${String(datos.plan)} (desde ${ipDe(req)})`);
          return json(res, 200, salida);
        } catch {
          return json(res, 502, { error: 'No consigo hablar con la app. ¿Está encendida?' });
        }
      }

      json(res, 404, { error: 'No existe.' });
    } catch (e) {
      console.error('[panel] error:', e);
      if (!res.headersSent) json(res, 500, { error: 'Error interno del panel.' });
      else res.end();
    }
  });
  servidor.requestTimeout = 20_000;
  servidor.headersTimeout = 10_000;
  return servidor;
}

// ───────── arranque ─────────
export function configDesdeEntorno(env: NodeJS.ProcessEnv = process.env): ConfigPanel {
  const contrasena = env.PANEL_PASSWORD ?? '';
  if (contrasena.length < 16) {
    throw new Error('PANEL_PASSWORD no está definida o es demasiado corta (mínimo 16 caracteres). Ejecuta: bash scripts/servidor.sh panel');
  }
  const clave = env.DATA_ENCRYPTION_KEY ? Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64') : undefined;
  const paginas = new URL('./panel/index.html', import.meta.url);
  return {
    contrasena,
    puerto: Number(env.PANEL_PORT ?? 8788),
    host: env.PANEL_HOST ?? '0.0.0.0',
    cookieSegura: env.PANEL_COOKIE_SEGURA !== 'false',
    html: readFileSync(paginas, 'utf8'),
    app: env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 32 ? { url: (env.APP_URL ?? 'http://app:8787').replace(/\/$/, ''), token: env.ADMIN_TOKEN } : undefined,
    datos: {
      archivoDatos: env.DATA_FILE ?? './data/store.json',
      claveDatos: clave,
      archivoHost: env.HOST_STATE ?? '/estado/host.json',
      archivoHistorial: env.HOST_HISTORY ?? '/estado/historial.jsonl',
      verImportes: env.PANEL_VER_IMPORTES === 'true',
      verPerfiles: env.PANEL_VER_PERFILES === 'true',
      verPsico: env.PANEL_VER_PSICO === 'true',
      premiumParaTodos: env.PREMIUM_FOR_ALL === 'true',
      puertoPanel: Number(env.PANEL_PORT ?? 8788),
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const cfg = configDesdeEntorno();
  crearPanel(cfg).listen(cfg.puerto, cfg.host, () => {
    console.log(`[panel] escuchando en ${cfg.host}:${cfg.puerto} · importes ${cfg.datos.verImportes ? 'VISIBLES' : 'ocultos'} · perfiles ${cfg.datos.verPerfiles ? 'ACTIVOS' : 'desactivados'} · psico ${cfg.datos.verPerfiles && cfg.datos.verPsico ? 'ACTIVA' : 'desactivada'}`);
  });
}

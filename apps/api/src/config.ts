import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('127.0.0.1'),
  /** Origen público de la web (CORS estricto + cookies). */
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  /** 32 bytes en base64. Cifra TOTP, y el fichero de datos en producción. */
  DATA_ENCRYPTION_KEY: z.string().optional(),
  DATA_FILE: z.string().default('./data/store.json'),
  /** Sirve la web compilada desde la propia API (útil en un servidor casero). */
  STATIC_DIR: z.string().optional(),
  ALLOW_DEMO_DATA: bool.optional(),
  /** true cuando hay un proxy inverso (Caddy/Cloudflare) delante: se confía en X-Forwarded-For. */
  TRUST_PROXY: bool.default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Mensajes por día y cuenta que se pueden enviar a Ian (acota el gasto de IA). */
  IAN_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(40),
  /** Comercios por día y cuenta que la IA puede buscar en internet al importar un extracto (0 = no buscar). */
  IMPORT_WEB_LOOKUPS_DAILY: z.coerce.number().int().min(0).max(2000).default(150),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),
  /** Mientras no haya cobro, todas las cuentas tienen las funciones Premium (consejos completos e IA). */
  PREMIUM_FOR_ALL: bool.default('false'),
  /** Cobro con Stripe. Sin las tres primeras, no hay cobro: la app solo enseña qué incluye Premium. */
  STRIPE_SECRET_KEY: z.string().min(20).optional(),
  STRIPE_PRICE_ID: z.string().min(5).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(10).optional(),
  /** Precio que se enseña si no se puede leer de Stripe (céntimos al mes). */
  PREMIUM_PRICE_CENTS: z.coerce.number().int().min(100).max(10_000).default(499),
  /** Días de prueba gratuita al suscribirse (0 = sin prueba). */
  PREMIUM_TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(0),
  /** Que Stripe calcule el IVA según el país (requiere activar Stripe Tax en su panel). */
  STRIPE_AUTOMATIC_TAX: bool.default('false'),
  /** Clave compartida con el panel del servidor para cambiar el plan de una cuenta. Sin ella, esa ruta no existe. */
  ADMIN_TOKEN: z.string().min(32).optional(),
  /** Dirección de descarga del APK de Android (la web la muestra en Ayuda y Ajustes). */
  APK_URL: z.string().url().optional(),
  /** Minutos sin actividad tras los que se cierra la sesión (0 = nunca). Cada persona puede activar «Mantener conectado». */
  IDLE_TIMEOUT_MIN: z.coerce.number().int().min(0).max(1440).default(10),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  host: string;
  publicOrigin: string;
  accessSecret: Uint8Array;
  dataKey: Buffer;
  dataFile: string | null;
  encryptDataFile: boolean;
  staticDir?: string;
  trustProxy: boolean;
  /** Intentos por minuto e IP en rutas sensibles de autenticación. */
  authRateLimit: number;
  allowDemoData: boolean;
  googleClientId?: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  ianDailyLimit: number;
  importWebLookupsDaily: number;
  vapid?: { publicKey: string; privateKey: string; subject: string };
  premiumForAll: boolean;
  adminToken?: string;
  /** Presente solo si el cobro está del todo configurado. */
  billing?: { secretKey: string; priceId: string; webhookSecret: string; trialDays: number; automaticTax: boolean };
  premiumPriceCents: number;
  idleTimeoutMin: number;
  apkUrl?: string;
}

function devKey(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString('base64'), { mode: 0o600 });
  return key;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  // Render publica la URL https del servicio en RENDER_EXTERNAL_URL: sirve de origen si no se fija otro.
  const e = envSchema.parse({ ...source, PUBLIC_ORIGIN: source.PUBLIC_ORIGIN || source.RENDER_EXTERNAL_URL || undefined });
  const isProd = e.NODE_ENV === 'production';

  if (isProd) {
    const missing = ['ACCESS_TOKEN_SECRET', 'DATA_ENCRYPTION_KEY'].filter((k) => !source[k]);
    if (missing.length) {
      throw new Error(`Faltan variables obligatorias en producción: ${missing.join(', ')} (usa "npm run gen:keys")`);
    }
    if (!e.PUBLIC_ORIGIN.startsWith('https://')) {
      throw new Error('PUBLIC_ORIGIN debe ser https:// en producción');
    }
  }

  let dataKey: Buffer;
  if (e.DATA_ENCRYPTION_KEY) {
    dataKey = Buffer.from(e.DATA_ENCRYPTION_KEY, 'base64');
    if (dataKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY debe ser 32 bytes en base64');
  } else if (e.NODE_ENV === 'test') {
    dataKey = randomBytes(32);
  } else {
    dataKey = devKey('./data/dev.key');
  }

  const accessSecret = new TextEncoder().encode(e.ACCESS_TOKEN_SECRET ?? randomBytes(48).toString('base64url'));

  return {
    env: e.NODE_ENV,
    isProd,
    port: e.PORT,
    host: e.HOST,
    publicOrigin: e.PUBLIC_ORIGIN,
    accessSecret,
    dataKey,
    dataFile: e.NODE_ENV === 'test' ? null : e.DATA_FILE,
    encryptDataFile: isProd,
    staticDir: e.STATIC_DIR,
    trustProxy: e.TRUST_PROXY,
    authRateLimit: e.NODE_ENV === 'test' ? 10_000 : 10,
    allowDemoData: e.ALLOW_DEMO_DATA ?? !isProd,
    googleClientId: e.GOOGLE_CLIENT_ID,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL,
    ianDailyLimit: e.IAN_DAILY_LIMIT,
    importWebLookupsDaily: e.IMPORT_WEB_LOOKUPS_DAILY,
    premiumForAll: e.PREMIUM_FOR_ALL,
    adminToken: e.ADMIN_TOKEN,
    billing:
      e.STRIPE_SECRET_KEY && e.STRIPE_PRICE_ID && e.STRIPE_WEBHOOK_SECRET
        ? { secretKey: e.STRIPE_SECRET_KEY, priceId: e.STRIPE_PRICE_ID, webhookSecret: e.STRIPE_WEBHOOK_SECRET, trialDays: e.PREMIUM_TRIAL_DAYS, automaticTax: e.STRIPE_AUTOMATIC_TAX }
        : undefined,
    premiumPriceCents: e.PREMIUM_PRICE_CENTS,
    idleTimeoutMin: e.IDLE_TIMEOUT_MIN,
    apkUrl: e.APK_URL,
    vapid:
      e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY
        ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT }
        : undefined,
  };
}

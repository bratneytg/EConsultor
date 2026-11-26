import type { CategoryPrefs, Lang, Plan, Recurring, Transaction, UiMode } from '@econsultor/shared';

/** Llave de acceso (huella, cara o PIN del dispositivo). Solo guardamos la clave PÚBLICA. */
export interface PasskeyRecord {
  /** ID de credencial, base64url. */
  id: string;
  /** Clave pública, base64url. */
  publicKey: string;
  counter: number;
  transports?: string[];
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash?: string;
  googleSub?: string;
  plan: Plan;
  currency: string;
  timezone: string;
  reminderEnabled: boolean;
  reminderTime: string; // HH:MM hora local del usuario
  /** Ausente en cuentas antiguas → «simple». */
  uiMode?: UiMode;
  lastReminderDate?: string; // YYYY-MM-DD local
  mfa: {
    enabled: boolean;
    secretSealed?: string;
    pendingSecretSealed?: string;
    lastStep?: number;
    recoveryHashes: string[];
  };
  /** Si es true, la sesión no se cierra por inactividad. Ausente → se cierra a los 10 min. */
  keepSignedIn?: boolean;
  /** Idioma de la app y de los textos que genera el servidor. Ausente → inglés. */
  language?: Lang;
  /** Categorías propias, nombres cambiados y categorías de serie ocultas al añadir. */
  categoryPrefs?: CategoryPrefs;
  /** Gastos e ingresos que se repiten cada mes. */
  recurring?: Recurring[];
  passkeys?: PasskeyRecord[];
  /** Dispositivos de la app de Android con huella nativa (el WebView no admite WebAuthn). Solo se guarda un hash del secreto. */
  appBiometrics?: AppBiometricRecord[];
  failedLogins: number;
  lockedUntil?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppBiometricRecord {
  id: string;
  name: string;
  /** SHA-256 del secreto de 256 bits que guarda el Keystore del teléfono, protegido por la huella. */
  secretHash: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
  /** Última vez que la persona usó la app (no cuenta el refresco en segundo plano). */
  lastActiveAt?: number;
  userAgent?: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  userId: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  userId?: string;
  type: string;
  at: string;
  ip?: string;
  detail?: string;
}

/** Reporte de fallo o idea enviado por una persona desde la app. */
export interface ReportRecord {
  id: string;
  userId?: string;
  at: string;
  kind: 'bug' | 'idea' | 'other';
  message: string;
  /** Ruta de la app donde estaba (por ejemplo /ajustes). */
  page?: string;
  /** web, android… */
  platform?: string;
  appVersion?: string;
  userAgent?: string;
  ip?: string;
}

export interface TxFilter {
  from?: string;
  to?: string;
  type?: 'income' | 'expense';
  categoryId?: string;
  /** Nombre de cuenta; '' = movimientos sin cuenta (la principal). */
  account?: string;
  limit?: number;
}

/**
 * Puerto de persistencia. Hoy lo implementa FileStore (servidor casero, un solo nodo).
 * Mañana: PostgresStore con la misma interfaz — el resto de la app no cambia.
 * Todas las operaciones son async para que el cambio sea transparente.
 */
export interface Store {
  users: {
    byId(id: string): Promise<UserRecord | undefined>;
    byEmail(email: string): Promise<UserRecord | undefined>;
    byGoogleSub(sub: string): Promise<UserRecord | undefined>;
    all(): Promise<UserRecord[]>;
    create(u: UserRecord): Promise<void>;
    update(u: UserRecord): Promise<void>;
    delete(id: string): Promise<void>;
  };
  sessions: {
    byId(id: string): Promise<SessionRecord | undefined>;
    byTokenHash(hash: string): Promise<SessionRecord | undefined>;
    create(s: SessionRecord): Promise<void>;
    update(s: SessionRecord): Promise<void>;
    revokeFamily(familyId: string): Promise<void>;
    revokeAllForUser(userId: string): Promise<void>;
  };
  transactions: {
    list(userId: string, filter?: TxFilter): Promise<Transaction[]>;
    get(userId: string, id: string): Promise<Transaction | undefined>;
    create(userId: string, t: Transaction): Promise<void>;
    update(userId: string, t: Transaction): Promise<void>;
    delete(userId: string, id: string): Promise<boolean>;
    deleteAllForUser(userId: string): Promise<void>;
  };
  push: {
    forUser(userId: string): Promise<PushSubscriptionRecord[]>;
    upsert(s: PushSubscriptionRecord): Promise<void>;
    remove(userId: string, endpoint: string): Promise<void>;
  };
  audit: {
    append(e: AuditEvent): Promise<void>;
    recent(userId: string, n: number): Promise<AuditEvent[]>;
  };
  reports: {
    create(r: ReportRecord): Promise<void>;
    /** Los más recientes primero. */
    recent(n: number): Promise<ReportRecord[]>;
    countSince(userId: string, sinceMs: number): Promise<number>;
    deleteForUser(userId: string): Promise<void>;
  };
  flush(): Promise<void>;
}

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Transaction } from '@econsultor/shared';
import { open, seal } from '../security/crypto.js';
import type {
  AuditEvent,
  PushSubscriptionRecord,
  ReportRecord,
  SessionRecord,
  Store,
  TxFilter,
  UserRecord,
} from './types.js';

type StoredTx = Transaction & { userId: string };

interface Snapshot {
  version: 1;
  users: UserRecord[];
  sessions: SessionRecord[];
  transactions: StoredTx[];
  push: PushSubscriptionRecord[];
  audit: AuditEvent[];
  reports?: ReportRecord[];
}

export interface FileStoreOptions {
  /** Ruta del fichero. `null` = solo memoria (tests). */
  file: string | null;
  /** Si se indica, el fichero se guarda cifrado con AES-256-GCM. */
  encryptionKey?: Buffer;
}

/**
 * Almacén en memoria con persistencia atómica a disco (write tmp + rename), con escrituras
 * agrupadas (debounce). Pensado para un único proceso en un servidor propio.
 * Para escalar horizontalmente se sustituye por una implementación SQL del puerto `Store`.
 */
export class FileStore implements Store {
  private users_ = new Map<string, UserRecord>();
  private sessions_ = new Map<string, SessionRecord>();
  private tx_ = new Map<string, StoredTx>();
  private push_ = new Map<string, PushSubscriptionRecord>();
  private audit_: AuditEvent[] = [];
  private reports_: ReportRecord[] = [];

  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly opts: FileStoreOptions) {
    if (opts.file) {
      mkdirSync(dirname(opts.file), { recursive: true });
      if (existsSync(opts.file)) this.load(opts.file);
    }
  }

  // ───────── persistencia ─────────
  private load(file: string): void {
    const raw = readFileSync(file, 'utf8');
    const json = this.opts.encryptionKey ? open(this.opts.encryptionKey, raw.trim()).toString('utf8') : raw;
    const snap = JSON.parse(json) as Snapshot;
    for (const u of snap.users) this.users_.set(u.id, u);
    for (const s of snap.sessions) this.sessions_.set(s.id, s);
    for (const t of snap.transactions) this.tx_.set(t.id, t);
    for (const p of snap.push) this.push_.set(p.endpoint, p);
    this.audit_ = snap.audit;
    this.reports_ = snap.reports ?? [];
  }

  private dirty(): void {
    if (!this.opts.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, 250);
    this.timer.unref();
  }

  private persist(): Promise<void> {
    const file = this.opts.file;
    if (!file) return Promise.resolve();
    const now = Date.now();
    const snap: Snapshot = {
      version: 1,
      users: [...this.users_.values()],
      // Las sesiones caducadas no tienen por qué persistir.
      sessions: [...this.sessions_.values()].filter((s) => s.expiresAt > now),
      transactions: [...this.tx_.values()],
      push: [...this.push_.values()],
      audit: this.audit_.slice(-5000),
      reports: this.reports_.slice(-500),
    };
    const json = JSON.stringify(snap);
    const out = this.opts.encryptionKey ? seal(this.opts.encryptionKey, json) : json;
    const tmp = `${file}.tmp`;
    this.writing = this.writing
      .then(async () => {
        await writeFile(tmp, out, { mode: 0o600 });
        await rename(tmp, file);
      })
      .catch((err) => {
        console.error('[store] error al persistir:', err);
      });
    return this.writing;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.persist();
  }

  // ───────── users ─────────
  users = {
    byId: async (id: string) => this.users_.get(id),
    byEmail: async (email: string) => [...this.users_.values()].find((u) => u.email === email),
    byGoogleSub: async (sub: string) => [...this.users_.values()].find((u) => u.googleSub === sub),
    all: async () => [...this.users_.values()],
    create: async (u: UserRecord) => {
      this.users_.set(u.id, u);
      this.dirty();
    },
    update: async (u: UserRecord) => {
      this.users_.set(u.id, u);
      this.dirty();
    },
    delete: async (id: string) => {
      this.users_.delete(id);
      this.dirty();
    },
  };

  // ───────── sessions ─────────
  sessions = {
    byId: async (id: string) => this.sessions_.get(id),
    byTokenHash: async (hash: string) => [...this.sessions_.values()].find((s) => s.tokenHash === hash),
    create: async (s: SessionRecord) => {
      this.sessions_.set(s.id, s);
      this.dirty();
    },
    update: async (s: SessionRecord) => {
      this.sessions_.set(s.id, s);
      this.dirty();
    },
    revokeFamily: async (familyId: string) => {
      const now = Date.now();
      for (const s of this.sessions_.values()) if (s.familyId === familyId && !s.revokedAt) s.revokedAt = now;
      this.dirty();
    },
    revokeAllForUser: async (userId: string) => {
      const now = Date.now();
      for (const s of this.sessions_.values()) if (s.userId === userId && !s.revokedAt) s.revokedAt = now;
      this.dirty();
    },
  };

  // ───────── transactions (siempre acotadas por userId) ─────────
  transactions = {
    list: async (userId: string, f: TxFilter = {}) => {
      let out = [...this.tx_.values()].filter((t) => t.userId === userId);
      if (f.from) out = out.filter((t) => t.date >= f.from!);
      if (f.to) out = out.filter((t) => t.date <= f.to!);
      if (f.type) out = out.filter((t) => t.type === f.type);
      if (f.categoryId) out = out.filter((t) => t.categoryId === f.categoryId);
      if (f.account !== undefined) out = out.filter((t) => (t.account ?? '') === f.account);
      out.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
      if (f.limit) out = out.slice(0, f.limit);
      return out.map(strip);
    },
    get: async (userId: string, id: string) => {
      const t = this.tx_.get(id);
      return t && t.userId === userId ? strip(t) : undefined;
    },
    create: async (userId: string, t: Transaction) => {
      this.tx_.set(t.id, { ...t, userId });
      this.dirty();
    },
    update: async (userId: string, t: Transaction) => {
      const prev = this.tx_.get(t.id);
      if (!prev || prev.userId !== userId) return;
      this.tx_.set(t.id, { ...t, userId });
      this.dirty();
    },
    delete: async (userId: string, id: string) => {
      const t = this.tx_.get(id);
      if (!t || t.userId !== userId) return false;
      this.tx_.delete(id);
      this.dirty();
      return true;
    },
    deleteAllForUser: async (userId: string) => {
      for (const [id, t] of this.tx_) if (t.userId === userId) this.tx_.delete(id);
      this.dirty();
    },
  };

  push = {
    forUser: async (userId: string) => [...this.push_.values()].filter((p) => p.userId === userId),
    upsert: async (s: PushSubscriptionRecord) => {
      this.push_.set(s.endpoint, s);
      this.dirty();
    },
    remove: async (userId: string, endpoint: string) => {
      const p = this.push_.get(endpoint);
      if (p && p.userId === userId) this.push_.delete(endpoint);
      this.dirty();
    },
  };

  audit = {
    append: async (e: AuditEvent) => {
      this.audit_.push(e);
      this.dirty();
    },
    recent: async (userId: string, n: number) => this.audit_.filter((e) => e.userId === userId).slice(-n).reverse(),
  };

  reports = {
    create: async (r: ReportRecord) => {
      this.reports_.push(r);
      this.dirty();
    },
    recent: async (n: number) => this.reports_.slice(-n).reverse(),
    countSince: async (userId: string, sinceMs: number) =>
      this.reports_.filter((r) => r.userId === userId && Date.parse(r.at) >= sinceMs).length,
    deleteForUser: async (userId: string) => {
      this.reports_ = this.reports_.filter((r) => r.userId !== userId);
      this.dirty();
    },
  };
}

function strip(t: StoredTx): Transaction {
  const { userId: _userId, ...rest } = t;
  return rest;
}

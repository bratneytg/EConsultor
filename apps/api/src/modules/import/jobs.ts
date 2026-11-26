import { randomUUID } from 'node:crypto';
import type { Lang } from '@econsultor/shared';
import { AppError } from '../../lib/errors.js';
import { runWithLang, trFor } from '../../lib/i18n.js';

/**
 * Tareas de análisis en el servidor.
 *
 * Analizar un extracto puede tardar minutos (PDF escaneado, OCR, IA que busca comercios en internet). Si el análisis fuera
 * la propia petición, en el móvil se cortaría al apagar la pantalla o cambiar de app. Aquí el archivo se sube una vez, el
 * servidor lo analiza por su cuenta y la app solo pregunta cómo va: puede cerrarse, dormirse o reiniciarse y, al volver,
 * recoge el resultado. El archivo sin procesar se descarta nada más terminar; el resultado se guarda solo en memoria y
 * caduca (o se borra al importarlo). Si el servidor se reinicia, las tareas en curso se pierden y hay que volver a subir.
 */

export type Stage = 'queued' | 'reading' | 'rules' | 'ai_knowledge' | 'ai_web' | 'checking';
export interface JobProgress { stage: Stage; done: number; total: number }
export interface JobError { status: number; code: string; message: string }

export interface Job<T = unknown> {
  id: string;
  userId: string;
  kind: 'preview' | 'classify';
  /** Clave de idempotencia: si la app reintenta la subida, no se crea una segunda tarea. */
  key: string;
  status: 'running' | 'done' | 'error';
  progress: JobProgress;
  createdAt: number;
  updatedAt: number;
  result?: T;
  error?: JobError;
  abort: AbortController;
}

export interface JobHooks {
  signal: AbortSignal;
  progress: (p: Partial<JobProgress> & { stage: Stage }) => void;
}

const KEEP_DONE_MS = 2 * 60 * 60_000;
const MAX_RUN_MS = 20 * 60_000;
const MAX_PER_USER = 6;
const MAX_CONCURRENT = 3;

export class JobStore {
  private jobs = new Map<string, Job>();
  private running = 0;
  private waiting: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.timer = setInterval(() => this.sweep(), 5 * 60_000);
    this.timer.unref();
  }

  private sweep(now = Date.now()): void {
    for (const [id, j] of this.jobs) {
      if (j.status === 'running' ? now - j.createdAt > MAX_RUN_MS + 60_000 : now - j.updatedAt > KEEP_DONE_MS) { j.abort.abort(); this.jobs.delete(id); }
    }
  }

  private async slot(): Promise<void> {
    if (this.running < MAX_CONCURRENT) { this.running++; return; }
    await new Promise<void>((r) => this.waiting.push(r));
  }
  private free(): void {
    const next = this.waiting.shift();
    if (next) next(); else this.running--;
  }

  /** Crea la tarea (o devuelve la que ya existe con esa clave) y la lanza en segundo plano. */
  start<T>(userId: string, kind: Job['kind'], key: string, lang: Lang, run: (h: JobHooks) => Promise<T>): Job<T> {
    const same = [...this.jobs.values()].find((j) => j.userId === userId && j.key === key);
    if (same) return same as Job<T>;
    const mine = [...this.jobs.values()].filter((j) => j.userId === userId);
    if (mine.some((j) => j.status === 'running' && j.kind === kind)) {
      throw new AppError(409, 'import_busy', 'Ya tienes un análisis en curso. Espera a que termine o descártalo.');
    }
    // Un tope de resultados guardados por cuenta: se tiran los terminados más antiguos.
    const finished = mine.filter((j) => j.status !== 'running').sort((a, b) => a.updatedAt - b.updatedAt);
    while (mine.length >= MAX_PER_USER && finished.length) { const old = finished.shift()!; this.jobs.delete(old.id); mine.splice(mine.indexOf(old), 1); }

    const now = Date.now();
    const job: Job<T> = { id: randomUUID(), userId, kind, key, status: 'running', progress: { stage: 'queued', done: 0, total: 0 }, createdAt: now, updatedAt: now, abort: new AbortController() };
    this.jobs.set(job.id, job as Job);
    const cap = setTimeout(() => job.abort.abort(), MAX_RUN_MS);
    cap.unref();
    void (async () => {
      await this.slot();
      try {
        if (job.abort.signal.aborted) throw new AppError(499, 'cancelled', 'Análisis cancelado.');
        const result = await runWithLang(lang, () => run({
          signal: job.abort.signal,
          progress: (p) => { job.progress = { stage: p.stage, done: p.done ?? 0, total: p.total ?? 0 }; job.updatedAt = Date.now(); },
        }));
        job.result = result;
        job.status = 'done';
      } catch (e) {
        job.status = 'error';
        job.error = e instanceof AppError
          ? { status: e.status, code: e.code, message: e.message }
          : { status: 500, code: 'internal', message: trFor(lang, 'No se pudo analizar el archivo. Inténtalo de nuevo.') };
      } finally {
        clearTimeout(cap);
        job.updatedAt = Date.now();
        this.free();
      }
    })();
    return job;
  }

  /** Solo la dueña de la tarea puede verla. */
  get(userId: string, id: string): Job | null {
    const j = this.jobs.get(id);
    return j && j.userId === userId ? j : null;
  }

  remove(userId: string, id: string): boolean {
    const j = this.get(userId, id);
    if (!j) return false;
    j.abort.abort();
    this.jobs.delete(id);
    return true;
  }

  /** Para las pruebas. */
  _reset(): void { for (const j of this.jobs.values()) j.abort.abort(); this.jobs.clear(); this.waiting = []; this.running = 0; }
}

export const importJobs = new JobStore();

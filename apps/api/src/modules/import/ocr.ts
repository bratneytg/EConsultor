import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Idiomas de Tesseract que interesan, en este orden; se usan los que haya instalados. */
const WANTED = ['spa', 'eng', 'deu', 'ita'];
const MAX_PAGES = 12;
const PAGE_TIMEOUT_MS = 60_000;

let langsCache: Promise<string | null> | null = null;
async function ocrLangs(): Promise<string | null> {
  langsCache ??= run('tesseract', ['--list-langs'], { timeout: 10_000 })
    .then(({ stdout }) => {
      const have = new Set(stdout.split('\n').map((s) => s.trim()));
      const use = WANTED.filter((l) => have.has(l));
      return use.length ? use.join('+') : have.has('eng') ? 'eng' : null;
    })
    .catch(() => null);
  return langsCache;
}

/** ¿Hay motor de OCR (Tesseract + poppler) en esta máquina? */
export async function ocrAvailable(): Promise<boolean> {
  if (!(await ocrLangs())) return false;
  try {
    await run('pdftoppm', ['-v'], { timeout: 5_000 });
    return true;
  } catch (e) {
    // pdftoppm -v escribe en stderr y a veces sale con 0; sólo importa que el binario exista.
    return (e as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

// Una sola lectura a la vez: el OCR gasta CPU y esta app suele vivir en un servidor doméstico.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
};

/**
 * Lee con OCR un PDF que sólo contiene imágenes (extractos escaneados o capturas exportadas a PDF).
 * Devuelve líneas de texto como `pdfLines`. Sin Tesseract instalado devuelve null.
 */
export function ocrPdfLines(data: Uint8Array): Promise<string[] | null> {
  return serial(async () => {
    const langs = await ocrLangs();
    if (!langs) return null;
    const dir = await mkdtemp(join(tmpdir(), 'econ-ocr-'));
    try {
      await writeFile(join(dir, 'in.pdf'), data);
      try {
        await run('pdftoppm', ['-r', '170', '-l', String(MAX_PAGES), '-png', join(dir, 'in.pdf'), join(dir, 'p')], { timeout: 120_000 });
      } catch {
        return null;
      }
      const pages = (await readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f)).sort();
      const lines: string[] = [];
      for (const f of pages) {
        try {
          const { stdout } = await run('tesseract', [join(dir, f), 'stdout', '-l', langs, '--psm', '6'], { timeout: PAGE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
          for (const l of stdout.split('\n')) {
            const t = l.replace(/\s+/g, ' ').trim();
            if (t) lines.push(t);
          }
        } catch {
          /* una página ilegible no tumba el resto */
        }
      }
      return lines;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

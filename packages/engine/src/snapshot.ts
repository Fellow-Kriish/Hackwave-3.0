import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The caches a run learns from and rewrites: planned plans and committed locators. */
const CACHE_DIRS = ['plans', 'locators'] as const;

/** Hand-written plans heal into a scratch cache that is never committed, and never snapshotted. */
const isCacheFile = (dir: string, file: string) => file.endsWith('.json') && !(dir === 'locators' && file.endsWith('.hand.json'));

/** Every plan and locator cache file under runs/, with its contents: what a run is put back to afterwards. */
export function captureCaches(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const dir of CACHE_DIRS) {
    const full = join(root, 'runs', dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) files.set(join(full, name), readFileSync(join(full, name), 'utf8'));
  }
  return files;
}

/** Puts the cache directories back exactly as captured: files added since are removed. */
export function putBackCaches(root: string, files: ReadonlyMap<string, string>): void {
  for (const dir of CACHE_DIRS) {
    const full = join(root, 'runs', dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) if (!files.has(join(full, name))) rmSync(join(full, name), { force: true });
  }
  for (const [file, content] of files) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function snapshotDir(root: string, name: string): string {
  if (!NAME.test(name)) throw new Error(`"${name}" is not a snapshot name: use lower-case words joined by hyphens, e.g. post-act-1`);
  return join(root, 'runs', 'snapshots', name);
}

export function listSnapshots(root: string): string[] {
  const dir = join(root, 'runs', 'snapshots');
  return existsSync(dir) ? readdirSync(dir).filter((name) => NAME.test(name)).sort() : [];
}

/** runs/snapshots/<name>/{plans,locators}: a copy of the current caches, replacing any older snapshot of that name. */
export function saveSnapshot(root: string, name: string): string[] {
  const target = snapshotDir(root, name);
  rmSync(target, { recursive: true, force: true });
  const saved: string[] = [];
  for (const dir of CACHE_DIRS) {
    const from = join(root, 'runs', dir);
    mkdirSync(join(target, dir), { recursive: true });
    if (!existsSync(from)) continue;
    for (const file of readdirSync(from).filter((candidate) => isCacheFile(dir, candidate))) {
      copyFileSync(join(from, file), join(target, dir, file));
      saved.push(`${dir}/${file}`);
    }
  }
  return saved;
}

/** Puts runs/plans and runs/locators back to the snapshot: its files are copied in, others removed (hand caches stay). */
export function restoreSnapshot(root: string, name: string): string[] {
  const source = snapshotDir(root, name);
  if (!existsSync(source)) throw new Error(`there is no snapshot "${name}"; save one with pnpm engine snapshot save ${name}`);
  const restored: string[] = [];
  for (const dir of CACHE_DIRS) {
    const to = join(root, 'runs', dir);
    const from = join(source, dir);
    const wanted = existsSync(from) ? readdirSync(from).filter((file) => isCacheFile(dir, file)) : [];
    mkdirSync(to, { recursive: true });
    for (const file of readdirSync(to).filter((candidate) => isCacheFile(dir, candidate))) {
      if (!wanted.includes(file)) rmSync(join(to, file), { force: true });
    }
    for (const file of wanted) {
      copyFileSync(join(from, file), join(to, file));
      restored.push(`${dir}/${file}`);
    }
  }
  return restored;
}

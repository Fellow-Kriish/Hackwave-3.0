import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SAME_SECOND_RUNS = 100;

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unnamed';
}

/** runs/<timestamp>-<intentId>-<target>, with a UTC timestamp that is safe in Windows paths. */
export function runFolderName(startedAt: Date, intentId: string, target: string): string {
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${slugify(intentId)}-${slugify(target)}`;
}

/** Creates a fresh run folder with its evidence/ subfolder; never reuses an existing one. */
export function createRunDir(runsRoot: string, intentId: string, target: string, startedAt = new Date()): string {
  mkdirSync(runsRoot, { recursive: true });
  const base = join(runsRoot, runFolderName(startedAt, intentId, target));
  for (let attempt = 1; attempt <= MAX_SAME_SECOND_RUNS; attempt++) {
    const dir = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      mkdirSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    mkdirSync(join(dir, 'evidence'));
    return dir;
  }
  throw new Error(`More than ${MAX_SAME_SECOND_RUNS} runs named ${base} in one second`);
}

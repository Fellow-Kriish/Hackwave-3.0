import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The directory holding engine.config.json, found from this file so the CLI works from any cwd. */
export function findRepoRoot(from: string = HERE): string {
  let dir = from;
  while (!existsSync(join(dir, 'engine.config.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`engine.config.json not found above ${from}`);
    dir = parent;
  }
  return dir;
}

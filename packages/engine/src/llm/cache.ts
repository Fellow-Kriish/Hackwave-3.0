import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@hackwave/contracts';

export interface TierPin {
  provider: string;
  model: string;
}

/** runs/llm-cache/manifest.json: which provider and models recorded the cache, and which prompt versions. */
export interface Manifest {
  version: 1;
  tiers: { strong: TierPin | null; fast: TierPin | null };
  prompts: Record<string, string>;
  updatedAt: string;
}

export interface CacheEntry {
  version: 1;
  key: string;
  stage: string;
  prompt: string;
  promptVersion: string;
  promptHash: string;
  provider: string;
  model: string;
  inputHash: string;
  /** The validated reply. */
  text: string;
  usage: { input: number; output: number };
  attempts: number;
  recordedAt: string;
}

/** hash(provider, model, prompt file hash, input hash): editing a prompt invalidates only its own entries. */
export function cacheKey(provider: string, model: string, promptHash: string, inputHash: string): string {
  return sha256(JSON.stringify([provider, model, promptHash, inputHash]));
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function readManifest(dir: string): Manifest | null {
  const manifest = readJson<Manifest>(join(dir, 'manifest.json'));
  if (manifest && (manifest.version !== 1 || typeof manifest.tiers !== 'object')) {
    throw new Error(`${join(dir, 'manifest.json')} is not a version 1 cache manifest`);
  }
  return manifest;
}

export class LlmCache {
  constructor(readonly dir: string) {}

  read(key: string): CacheEntry | null {
    return readJson<CacheEntry>(join(this.dir, `${key}.json`));
  }

  write(entry: CacheEntry): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${entry.key}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  }

  readManifest(): Manifest | null {
    return readManifest(this.dir);
  }

  writeManifest(manifest: Manifest): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

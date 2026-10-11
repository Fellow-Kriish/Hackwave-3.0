import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Each key in .env belongs to the provider named next to it in .env. */
const KEY_OWNERS: [providerVar: string, keyVar: string][] = [
  ['LLM_PROVIDER', 'LLM_API_KEY'],
  ['LLM_PROVIDER_FAST', 'LLM_API_KEY_FAST'],
];

/**
 * Loads <repo>/.env into process.env without overriding variables already set in the shell.
 * If the shell picks a different provider than .env names, that provider does not borrow .env's key:
 * a key is never sent to a provider it was not issued for.
 * HACKWAVE_DOTENV=0 skips the file, to prove a run works with no .env at all (replay mode).
 */
export function loadDotEnv(root: string): string | null {
  if (process.env.HACKWAVE_DOTENV === '0') return null;
  const file = join(root, '.env');
  if (!existsSync(file)) return null;
  const values: Record<string, string | undefined> = { ...parseEnv(readFileSync(file, 'utf8')) };
  for (const [providerVar, keyVar] of KEY_OWNERS) {
    const shellProvider = process.env[providerVar];
    if (shellProvider !== undefined && shellProvider.trim() !== (values[providerVar] ?? '').trim()) delete values[keyVar];
  }
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
  return file;
}

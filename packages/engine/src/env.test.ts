import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from './env';

const VARS = ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_MODEL_STRONG', 'LLM_PROVIDER_FAST', 'LLM_API_KEY_FAST', 'HACKWAVE_DOTENV'];
let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'env-test-'));
  saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
  for (const name of VARS) delete process.env[name];
  writeFileSync(join(dir, '.env'), 'LLM_PROVIDER=groq\nLLM_API_KEY=groq-key\nLLM_MODEL_STRONG=m\n');
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('loadDotEnv', () => {
  it('loads .env without overriding the shell', () => {
    process.env.LLM_MODEL_STRONG = 'from-shell';
    loadDotEnv(dir);
    expect(process.env.LLM_PROVIDER).toBe('groq');
    expect(process.env.LLM_API_KEY).toBe('groq-key');
    expect(process.env.LLM_MODEL_STRONG).toBe('from-shell');
  });

  it('never lends a .env key to a provider the shell picked instead', () => {
    process.env.LLM_PROVIDER = 'custom';
    loadDotEnv(dir);
    expect(process.env.LLM_API_KEY).toBeUndefined();
  });

  it('can be skipped entirely', () => {
    process.env.HACKWAVE_DOTENV = '0';
    expect(loadDotEnv(dir)).toBeNull();
    expect(process.env.LLM_API_KEY).toBeUndefined();
  });
});

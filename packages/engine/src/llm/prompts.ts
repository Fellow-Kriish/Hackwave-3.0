import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@hackwave/contracts';

export interface PromptFile {
  name: string;
  /** From the first line, "version: planner/1". */
  version: string;
  /** Everything after the version line: the static system prompt. */
  text: string;
  /** Hash of the whole file, part of every cache key. */
  hash: string;
}

/** Loads prompts/<name>.md. Line endings are normalised so a Windows checkout hashes like any other. */
export function loadPrompt(root: string, name: string): PromptFile {
  const file = join(root, 'prompts', `${name}.md`);
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const [first = '', ...rest] = raw.split('\n');
  const match = /^version:\s*(\S+)\s*$/.exec(first);
  if (!match?.[1]) throw new Error(`${file}: the first line must be "version: <name>/<number>"`);
  return { name, version: match[1], text: rest.join('\n').trim(), hash: sha256(raw) };
}

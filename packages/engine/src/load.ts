import { readFileSync } from 'node:fs';
import { parseIntent, parsePlan, type Intent, type Plan } from '@hackwave/contracts';

function readJson(file: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${what} ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function loadIntent(file: string): Intent {
  return parseIntent(readJson(file, 'intent'), `intent ${file}`);
}

export function loadPlan(file: string): Plan {
  return parsePlan(readJson(file, 'plan'), `plan ${file}`);
}

import { readFileSync } from 'node:fs';
import { ContractError, parsePlan, type Intent, type Plan } from '@hackwave/contracts';
import { formatLint, lintIntentText } from './intent-lint';

function readText(file: string, what: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${what} ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`, { cause: error });
  }
}

function readJson(file: string, what: string): unknown {
  const text = readText(file, what);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${what} ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** The intent, or a ContractError with the same line-by-line problems `pnpm engine lint` prints. */
export function loadIntent(file: string): Intent {
  const result = lintIntentText(readText(file, 'intent'));
  if (!result.intent) throw new ContractError(`intent ${formatLint(file, result)}`);
  return result.intent;
}

export function loadPlan(file: string): Plan {
  return parsePlan(readJson(file, 'plan'), `plan ${file}`);
}

import { BudgetsSchema, IntentSchema, OracleSchema, type Intent } from '@hackwave/contracts';
import type { z } from 'zod';

/** One thing wrong with an intent file, where it is, and what to write instead. */
export interface LintProblem {
  /** Dotted path, e.g. "oracle.ui" or "inputs.card.number"; "" for the whole file. */
  path: string;
  line: number | null;
  message: string;
}

export interface LintResult {
  /** The validated intent, when there are no problems. */
  intent: Intent | null;
  problems: LintProblem[];
}

/** Fields allowed at each object path, from the schema itself. */
const ALLOWED: Record<string, readonly string[]> = {
  '': Object.keys(IntentSchema.shape),
  oracle: Object.keys(OracleSchema.shape),
  'oracle.state': Object.keys(OracleSchema.shape.state.shape),
  'oracle.state.match': Object.keys(OracleSchema.shape.state.shape.match.shape),
  'oracle.ui': Object.keys(OracleSchema.shape.ui.shape),
  budgets: Object.keys(BudgetsSchema.shape),
};

/** What to add when a required field is missing. */
const MISSING: Record<string, string> = {
  id: 'add "id": lower-case words joined by hyphens, e.g. "checkout-valid-card"',
  goal: 'add "goal": one plain sentence saying what the user achieves',
  inputs: 'add "inputs": { ... } with every value the test types or picks',
  oracle: 'add "oracle": { "state": { ... }, "ui": { ... } }, how success is checked in the system of record',
  'oracle.state': 'add "state": { "store": "orders", "expectedNewCount": 1, "match": { ... } }',
  'oracle.state.store': 'add "store": the collection the app writes to, read through /api/<store>',
  'oracle.state.expectedNewCount': 'add "expectedNewCount": 1',
  'oracle.state.match': 'add "match": the fields the new record must carry, e.g. { "total": 1299 }',
  'oracle.ui': 'add "ui": { "newRecordIdVisible": true, "noAlerts": true }',
  'oracle.ui.newRecordIdVisible': 'add "newRecordIdVisible": true',
  'oracle.ui.noAlerts': 'add "noAlerts": true',
};

const INPUT_NAME = /^[a-z][a-zA-Z0-9]*$/;
const PLACEHOLDER = /\bTODO\b/;

const join = (base: string, key: string | number) => (base ? `${base}.${key}` : String(key));

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'true or false';
  return typeof value;
}

function valueAt(root: unknown, path: string): unknown {
  let value = root;
  for (const part of path ? path.split('.') : []) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/** "Checkout with a valid card" becomes "checkout-with-a-valid-card". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** The line each JSON path starts on, from a scan of text that is already known to be valid JSON. */
export function jsonPathLines(text: string): Map<string, number> {
  const lines = new Map<string, number>();
  let pos = 0;
  let line = 1;
  const skip = () => {
    while (pos < text.length && /\s/.test(text.charAt(pos))) {
      if (text.charAt(pos) === '\n') line++;
      pos++;
    }
  };
  const string = (): string => {
    let out = '';
    pos++;
    while (pos < text.length && text.charAt(pos) !== '"') {
      if (text.charAt(pos) === '\\') {
        out += text.charAt(pos + 1);
        pos += 2;
      } else out += text.charAt(pos++);
    }
    pos++;
    return out;
  };
  const value = (path: string): void => {
    skip();
    lines.set(path, line);
    const open = text.charAt(pos);
    if (open === '{' || open === '[') {
      const close = open === '{' ? '}' : ']';
      pos++;
      skip();
      if (text.charAt(pos) === close) {
        pos++;
        return;
      }
      for (let index = 0; ; index++) {
        skip();
        if (open === '{') {
          const key = string();
          skip();
          pos++; // the colon
          value(join(path, key));
        } else value(join(path, index));
        skip();
        if (text.charAt(pos++) !== ',') return;
      }
    }
    if (open === '"') {
      string();
      return;
    }
    while (pos < text.length && !/[\s,\]}]/.test(text.charAt(pos))) pos++;
  };
  value('');
  return lines;
}

/** Inputs are checked by hand: the schema's union only says "invalid input", never which field or why. */
function inputProblems(inputs: unknown): { path: string; message: string }[] {
  if (inputs === undefined) return [];
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return [{ path: 'inputs', message: `must be an object of named values, got ${kindOf(inputs)}` }];
  }
  const problems: { path: string; message: string }[] = [];
  const name = (path: string, key: string) => {
    if (!INPUT_NAME.test(key)) problems.push({ path, message: `"${key}" is not an input name: use lowerCamelCase letters and digits, e.g. "cardNumber"` });
  };
  for (const [key, value] of Object.entries(inputs)) {
    const path = `inputs.${key}`;
    name(path, key);
    if (typeof value === 'string') continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push({ path, message: `must be text in quotes, or a group such as { "number": "..." }; got ${kindOf(value)}` });
      continue;
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      const fieldPath = `${path}.${field}`;
      name(fieldPath, field);
      if (typeof fieldValue !== 'string') problems.push({ path: fieldPath, message: `must be text in quotes, got ${kindOf(fieldValue)} (groups are one level deep)` });
    }
  }
  return problems;
}

/** Every string still holding a placeholder from `pnpm engine init`. */
function placeholders(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return PLACEHOLDER.test(value) ? [path] : [];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => placeholders(child, join(path, key)));
}

function readable(issue: z.core.$ZodIssue, raw: unknown): { path: string; message: string }[] {
  const path = issue.path.map(String).join('.');
  switch (issue.code) {
    case 'unrecognized_keys': {
      const allowed = ALLOWED[path];
      return issue.keys.map((key) => ({ path: join(path, key), message: `unknown field${allowed ? `; allowed here: ${allowed.join(', ')}` : ''}` }));
    }
    case 'invalid_type': {
      const actual = valueAt(raw, path);
      if (actual === undefined) return [{ path, message: `missing: ${MISSING[path] ?? `add it (${issue.expected})`}` }];
      return [{ path, message: `must be ${issue.expected === 'number' ? 'a number' : issue.expected === 'string' ? 'text in quotes' : issue.expected}, got ${kindOf(actual)}` }];
    }
    case 'too_small':
      if (path === 'goal') return [{ path, message: 'too short: write the goal as one plain sentence (at least 10 characters)' }];
      if (issue.origin === 'array') return [{ path, message: `needs at least ${String(issue.minimum)} entr${issue.minimum === 1 ? 'y' : 'ies'}` }];
      return [{ path, message: `must be at least ${String(issue.minimum)}` }];
    case 'invalid_format':
      if (path === 'id') {
        const id = valueAt(raw, 'id');
        const suggestion = typeof id === 'string' ? slugify(id) : '';
        return [{ path, message: `${typeof id === 'string' ? `"${id}" is not an id: ` : ''}use lower-case words joined by hyphens${suggestion ? `, e.g. "${suggestion}"` : ''}` }];
      }
      return [{ path, message: issue.message }];
    default:
      return [{ path, message: issue.message }];
  }
}

/** Where a JSON parse error points: Node reports "(line L column C)" or "at position P". */
function syntaxProblem(text: string, error: unknown): LintProblem {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumn = /\(line (\d+) column (\d+)\)/.exec(message);
  const position = /position (\d+)/.exec(message);
  let line: number | null = null;
  let column: number | null = null;
  if (lineColumn) {
    line = Number(lineColumn[1]);
    column = Number(lineColumn[2]);
  } else if (position) {
    const before = text.slice(0, Number(position[1]));
    line = before.split('\n').length;
    column = before.length - before.lastIndexOf('\n');
  }
  const what = message.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '');
  return { path: '', line, message: `not valid JSON${column !== null ? ` (column ${column})` : ''}: ${what}` };
}

/**
 * Lints an intent file's text: JSON syntax, the schema with a readable message per field, inputs field by field,
 * and placeholders left by `init`. Structure only: the oracle's values are never interpreted here.
 */
export function lintIntentText(text: string): LintResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { intent: null, problems: [syntaxProblem(text, error)] };
  }
  const lines = jsonPathLines(text);
  const lineOf = (path: string): number | null => {
    for (let at = path; ; at = at.includes('.') ? at.slice(0, at.lastIndexOf('.')) : '') {
      const line = lines.get(at);
      if (line !== undefined) return line;
      if (at === '') return null;
    }
  };

  const found: { path: string; message: string }[] = [];
  for (const path of placeholders(raw)) found.push({ path, message: 'still a placeholder from pnpm engine init: replace the TODO text with the real value' });
  const inputs = inputProblems(valueAt(raw, 'inputs'));
  found.push(...inputs);
  const parsed = IntentSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      for (const problem of readable(issue, raw)) {
        // The hand-made input checks and placeholder notes already say it better for these paths.
        if (problem.path === 'inputs' ? inputs.length > 0 : problem.path.startsWith('inputs.')) continue;
        if (found.some((earlier) => earlier.path === problem.path)) continue;
        found.push(problem);
      }
    }
  }
  const problems = found.map((problem) => ({ ...problem, line: lineOf(problem.path) })).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { intent: problems.length === 0 && parsed.success ? parsed.data : null, problems };
}

/** "intents/bad.json is invalid (3 problems):" then one aligned line per problem. */
export function formatLint(file: string, result: LintResult): string {
  if (result.problems.length === 0) return `${file}: ok`;
  const width = Math.max(...result.problems.map((problem) => (problem.path || '(file)').length));
  const lines = result.problems.map((problem) => {
    const where = problem.line === null ? '        ' : `line ${String(problem.line).padEnd(3)}`;
    return `  ${where} ${(problem.path || '(file)').padEnd(width)}  ${problem.message}`;
  });
  return [`${file} is invalid (${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}):`, ...lines].join('\n');
}

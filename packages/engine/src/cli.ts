import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { runDemo } from './demo';
import { runDoctor, type Check } from './doctor';
import { loadDotEnv } from './env';
import { runEvals } from './evals';
import { idFromGoal, scaffoldIntent } from './init';
import { formatLint, lintIntentText } from './intent-lint';
import { findRepoRoot } from './paths';
import { listSnapshots, restoreSnapshot, saveSnapshot } from './snapshot';
import { exitCodeFor, runIntent, SetupError } from './run';

const USAGE = `usage: pnpm engine <command> [options]

available now:
  demo                                   the four acts in replay, headed with slowMo 300, from runs/snapshots/post-act-1
      [--cues] [--video] [--headless]    presenter lines; video.webm per act; no browser window
      [--slow-mo <ms>] [--keep-caches]   leave the caches as act 4 left them
      [--with-wrong-total]               a fifth act on the reserve bug (order saved at the wrong price)
      [--llm-mode replay|record|live]    replay unless told otherwise; record fills gaps in runs/llm-cache
  doctor [--reset]                       preflight: Node, shops, reset endpoint, baseline, browser, replay cache, prompts, intents
  run --intent <file> --target <url>     one execution; streams events and writes a run folder under runs/
      [--plan <file>]                    a hand-written plan; without it the cached plan or the planner is used
      [--llm-mode live|record|replay]    overrides LLM_MODE (replay needs no API key)
      [--headed] [--slow-mo <ms>]
  eval [fixture...] [--verbose]          runs the named (or all) eval fixtures, in file order, and compares verdicts
      [--llm-mode live|record|replay]    plan and locator caches are restored afterwards
      [--keep-caches]                    ... unless this is given
      [--headed] [--slow-mo <ms>]        watch every fixture's browser
  lint <intent...>                       checks intent files: JSON, schema, inputs, placeholders; one line per problem
  init <goal> [--id <id>] [--out <file>] scaffolds intents/<id>.json from a goal sentence, with TODOs that lint flags
  snapshot save|restore <name>           copies the plan and locator caches to or from runs/snapshots/<name>
  snapshot list

exit codes: run and eval 0 GREEN or AMBER · 1 RED · 2 GREY · 3 setup error; demo 0 as scripted · 1 not;
            lint 0 clean · 1 problems`;
const LLM_MODES = new Set(['live', 'record', 'replay']);
/** The doc's stage setting: slow enough for an audience to follow each click. */
const DEMO_SLOW_MO_MS = 300;

function llmMode(value: string | undefined): string | undefined {
  if (value !== undefined && !LLM_MODES.has(value)) throw new SetupError(`--llm-mode must be live, record or replay (got "${value}")`);
  return value;
}

function slowMoOf(value: string | undefined): number {
  const slowMo = value === undefined ? 0 : Number(value);
  if (!Number.isInteger(slowMo) || slowMo < 0) throw new SetupError('--slow-mo must be a whole number of milliseconds');
  return slowMo;
}

function printChecks(checks: Check[]): void {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '-';
    console.log(`  ${mark} ${check.name.padEnd(width)}  ${check.detail}`);
  }
}

async function doctor(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { reset: { type: 'boolean', default: false } }, strict: true });
  const root = findRepoRoot();
  const config = loadConfig(root);
  console.log('doctor');
  const checks = await runDoctor(config, { reset: values.reset, root });
  printChecks(checks);
  const failed = checks.filter((check) => check.status === 'fail').length;
  console.log(failed === 0 ? '\ndoctor: ready' : `\ndoctor: ${failed} check(s) failed; fix them before running`);
  return failed === 0 ? 0 : 1;
}

async function run(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      intent: { type: 'string' },
      target: { type: 'string' },
      plan: { type: 'string' },
      'llm-mode': { type: 'string' },
      headed: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
    },
  });
  if (!values.intent || !values.target) throw new SetupError('run needs --intent <file> and --target <url>');
  const slowMo = slowMoOf(values['slow-mo']);
  const mode = llmMode(values['llm-mode']);
  const { verdict } = await runIntent({
    intentFile: values.intent,
    target: values.target,
    planFile: values.plan,
    headed: values.headed,
    slowMo,
    envOverride: mode ? { LLM_MODE: mode } : {},
  });
  return exitCodeFor(verdict);
}

async function evaluate(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      verbose: { type: 'boolean', default: false },
      'llm-mode': { type: 'string' },
      'keep-caches': { type: 'boolean', default: false },
      headed: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
    },
  });
  return runEvals({
    only: positionals,
    verbose: values.verbose,
    llmMode: llmMode(values['llm-mode']),
    keepCaches: values['keep-caches'],
    headed: values.headed,
    slowMo: slowMoOf(values['slow-mo']),
  });
}

function lint(args: string[]): number {
  const { positionals } = parseArgs({ args, strict: true, allowPositionals: true, options: {} });
  if (positionals.length === 0) throw new SetupError('lint needs one or more intent files, e.g. pnpm engine lint intents/checkout.json');
  let problems = 0;
  for (const file of positionals) {
    let text: string;
    try {
      text = readFileSync(resolve(file), 'utf8');
    } catch (error) {
      throw new SetupError(`cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
    }
    const result = lintIntentText(text);
    problems += result.problems.length;
    console.log(result.problems.length === 0 ? `✓ ${file}: a valid intent (${result.intent?.id})` : `✗ ${formatLint(file, result)}`);
  }
  return problems === 0 ? 0 : 1;
}

function init(args: string[]): number {
  const { values, positionals } = parseArgs({ args, strict: true, allowPositionals: true, options: { id: { type: 'string' }, out: { type: 'string' } } });
  const goal = positionals.join(' ').trim();
  if (goal.length < 10) throw new SetupError('init needs the goal as one sentence, e.g. pnpm engine init "As a shopper, buy a gift card and reach confirmation."');
  const id = values.id ?? idFromGoal(goal);
  const root = findRepoRoot();
  const file = values.out ? resolve(values.out) : join(root, 'intents', `${id}.json`);
  if (existsSync(file)) throw new SetupError(`${file} already exists; pick another --id or --out`);
  const text = scaffoldIntent(goal, id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { flag: 'wx' });
  const inside = relative(root, file);
  const label = (inside.startsWith('..') ? file : inside).replace(/\\/g, '/');
  console.log(`wrote ${label}\n`);
  console.log(formatLint(label, lintIntentText(text)));
  console.log(`\nnext: replace every TODO, then pnpm engine lint ${label}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  loadDotEnv(findRepoRoot());
  const [command, ...args] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === 'doctor') return doctor(args);
  if (command === 'run') return run(args);
  if (command === 'eval') return evaluate(args);
  if (command === 'lint') return lint(args);
  if (command === 'init') return init(args);
  if (command === 'snapshot') return snapshot(args);
  if (command === 'demo') return demo(args);
  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  return 2;
}

function snapshot(args: string[]): number {
  const [action, name] = parseArgs({ args, strict: true, allowPositionals: true, options: {} }).positionals;
  const root = findRepoRoot();
  try {
    if (action === 'list') {
      const names = listSnapshots(root);
      console.log(names.length > 0 ? names.join('\n') : 'no snapshots yet; save one with pnpm engine snapshot save <name>');
      return 0;
    }
    if ((action !== 'save' && action !== 'restore') || !name) throw new SetupError('usage: pnpm engine snapshot save|restore <name>, or snapshot list');
    const files = action === 'save' ? saveSnapshot(root, name) : restoreSnapshot(root, name);
    const where = `runs/snapshots/${name}`;
    console.log(action === 'save' ? `saved ${files.length} cache file(s) to ${where}: ${files.join(', ')}` : `restored ${files.length} cache file(s) from ${where}: ${files.join(', ')}`);
    return 0;
  } catch (error) {
    if (error instanceof SetupError) throw error;
    throw new SetupError(error instanceof Error ? error.message : String(error));
  }
}

async function demo(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cues: { type: 'boolean', default: false },
      video: { type: 'boolean', default: false },
      headless: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
      'keep-caches': { type: 'boolean', default: false },
      'with-wrong-total': { type: 'boolean', default: false },
      'llm-mode': { type: 'string' },
    },
  });
  const result = await runDemo({
    headed: !values.headless,
    slowMo: values['slow-mo'] === undefined ? DEMO_SLOW_MO_MS : slowMoOf(values['slow-mo']),
    video: values.video,
    cues: values.cues,
    keepCaches: values['keep-caches'],
    withWrongTotal: values['with-wrong-total'],
    // The demo runs from the recorded cache unless asked otherwise: no key, no network, the same replies every time.
    envOverride: { LLM_MODE: llmMode(values['llm-mode']) ?? 'replay' },
    quiet: false,
  });
  return result.problems.length === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const setup = error instanceof SetupError || (error instanceof Error && error.name === 'ContractError');
    console.error(`${setup ? 'setup error: ' : ''}${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = setup ? 3 : 1;
  },
);

import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { runDoctor, type Check } from './doctor';
import { loadDotEnv } from './env';
import { runEvals } from './evals';
import { findRepoRoot } from './paths';
import { exitCodeFor, runIntent, SetupError } from './run';

const USAGE = `usage: pnpm engine <command> [options]

available now:
  doctor [--reset]                       preflight: shop ports, reset endpoint, baseline, browser, replay cache
  run --intent <file> --target <url>     one execution; streams events and writes a run folder under runs/
      [--plan <file>]                    a hand-written plan; without it the cached plan or the planner is used
      [--llm-mode live|record|replay]    overrides LLM_MODE (replay needs no API key)
      [--headed] [--slow-mo <ms>]
  eval [fixture...] [--verbose]          runs the named (or all) eval fixtures, in file order, and compares verdicts
      [--llm-mode live|record|replay]    plan and locator caches are restored afterwards
      [--keep-caches]                    ... unless this is given
      [--headed] [--slow-mo <ms>]        watch every fixture's browser

planned (docs/BUILD.md):
  lint <intent>                          P5
  init <goal>                            P5
  snapshot save|restore <name>           P6
  demo                                   P6

exit codes: 0 GREEN or AMBER · 1 RED · 2 GREY · 3 setup error`;

const PLANNED: Record<string, string> = { lint: 'P5', init: 'P5', snapshot: 'P6', demo: 'P6' };
const LLM_MODES = new Set(['live', 'record', 'replay']);

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
  const phase = PLANNED[command];
  console.error(phase ? `"${command}" is planned for ${phase} and not built yet.` : `Unknown command "${command}".\n\n${USAGE}`);
  return 2;
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

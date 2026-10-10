import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { runDoctor, type Check } from './doctor';
import { runEvals } from './evals';
import { exitCodeFor, runIntent, SetupError } from './run';

const USAGE = `usage: pnpm engine <command> [options]

available now:
  doctor [--reset]                                  preflight: shop ports, reset endpoint, baseline, browser, replay cache
  run --intent <file> --target <url> --plan <file>  one execution; streams events and writes a run folder under runs/
      [--headed] [--slow-mo <ms>]                   (--plan is optional once the planner exists, in P2)
  eval [fixture] [--verbose]                        runs one or all eval fixtures and compares verdicts

planned (docs/BUILD.md):
  run ... --llm-mode live|record|replay             P2
  lint <intent>                                     P5
  init <goal>                                       P5
  snapshot save|restore <name>                      P6
  demo                                              P6

exit codes: 0 GREEN or AMBER · 1 RED · 2 GREY · 3 setup error`;

const PLANNED: Record<string, string> = { lint: 'P5', init: 'P5', snapshot: 'P6', demo: 'P6' };

function printChecks(checks: Check[]): void {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '-';
    console.log(`  ${mark} ${check.name.padEnd(width)}  ${check.detail}`);
  }
}

async function doctor(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { reset: { type: 'boolean', default: false } }, strict: true });
  const config = loadConfig();
  console.log('doctor');
  const checks = await runDoctor(config, { reset: values.reset });
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
      headed: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
    },
  });
  if (!values.intent || !values.target) throw new SetupError('run needs --intent <file> and --target <url>');
  const slowMo = values['slow-mo'] === undefined ? 0 : Number(values['slow-mo']);
  if (!Number.isInteger(slowMo) || slowMo < 0) throw new SetupError('--slow-mo must be a whole number of milliseconds');
  const { verdict } = await runIntent({ intentFile: values.intent, target: values.target, planFile: values.plan, headed: values.headed, slowMo });
  return exitCodeFor(verdict);
}

async function evaluate(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { verbose: { type: 'boolean', default: false } },
  });
  return runEvals({ only: positionals[0], verbose: values.verbose });
}

async function main(argv: string[]): Promise<number> {
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

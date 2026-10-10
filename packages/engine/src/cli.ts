import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { runDoctor, type Check } from './doctor';

const USAGE = `usage: pnpm engine <command> [options]

available now:
  doctor [--reset]   preflight: shop ports, reset endpoint, baseline, browser, replay cache

planned (docs/BUILD.md):
  run --intent <file> --target <url> [--plan <file>] [--llm-mode live|record|replay]   P1
  eval [fixture]                                                                         P1
  lint <intent>                                                                          P5
  init <goal>                                                                            P5
  snapshot save|restore <name>                                                           P6
  demo                                                                                   P6`;

const PLANNED: Record<string, string> = { run: 'P1', eval: 'P1', lint: 'P5', init: 'P5', snapshot: 'P6', demo: 'P6' };

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

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === 'doctor') return doctor(args);
  const phase = PLANNED[command];
  console.error(phase ? `"${command}" is planned for ${phase} and not built yet.` : `Unknown command "${command}".\n\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);

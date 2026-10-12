import { spawn } from 'node:child_process';
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
import { loadIntent } from './load';
import { findRepoRoot } from './paths';
import { listSnapshots, restoreSnapshot, saveSnapshot } from './snapshot';
import { exitCodeFor, exploreGoal, isVerified, runGoal, runIntent, SetupError } from './run';
import { loadProjects, projectFor } from './projects';
import { exploreIntent, parseInputs, passedUnverified } from './explore';
import { fetchCatalog, typedIntent } from './typed-goal';
import { startUiServer } from './ui/server';

const USAGE = `usage: pnpm engine <command> [options]

available now:
  demo                                   the four acts in replay, headed with slowMo 300, from runs/snapshots/post-act-1
      [--cues] [--video] [--headless]    presenter lines; video.webm per act; no browser window
      [--slow-mo <ms>] [--keep-caches]   leave the caches as act 4 left them
      [--with-wrong-total]               a fifth act on the reserve bug (order saved at the wrong price)
      [--same-url]                       one address for every act: Version A is deployed, then B is deployed over it
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
  try "<goal>" [--target <url>]          type a goal in plain words and test it now: planned by the model, checked by code
      [--save] [--data <intent>]         keep it as intents/<id>.json; test data from another intent (default checkout)
      [--headed] [--slow-mo <ms>] [--llm-mode live|record|replay]   live by default: a new sentence has no recording
  ui [--port <n>] [--no-open]            the web app: type a goal, pick a version, watch it plan, act, heal and verify
      [--headless] [--slow-mo <ms>]      a browser window is shown with slowMo 300 unless told otherwise
  projects [url]                         lists projects/*.json (one per app: where its source of truth lives) and,
                                         given a URL, which project a run there loads
  explore "<goal>" --target <url>        any website: plans, clicks and heals, but checks nothing, so the result is
      [--input key=value]...             passes tagged "unverified" (never GREEN); --input gives it words to type, e.g. query="water bottle"
      [--headless] [--slow-mo <ms>] [--llm-mode live|record|replay]   headed with slowMo 300 unless told otherwise
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
  if (command === 'try') return tryGoal(args);
  if (command === 'demo') return demo(args);
  if (command === 'ui') return ui(args);
  if (command === 'explore') return explore(args);
  if (command === 'projects') return projectsCommand(args);
  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  return 2;
}

/**
 * A goal typed in plain words, tested right away: the intent is built around it (test data from an existing intent,
 * a success check written by code), then planned from scratch, run, healed and verified like any other.
 */
async function tryGoal(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      target: { type: 'string', default: 'http://localhost:5171' },
      data: { type: 'string' },
      save: { type: 'boolean', default: false },
      'llm-mode': { type: 'string' },
      headed: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
    },
  });
  const goal = positionals.join(' ').trim();
  if (goal.length < 10) throw new SetupError('try needs the goal as one sentence, e.g. pnpm engine try "Complete checkout with a valid credit card"');
  const root = findRepoRoot();
  let origin: string;
  try {
    origin = new URL(values.target).origin;
  } catch {
    throw new SetupError(`--target must be a URL, e.g. http://localhost:5171 (got "${values.target}")`);
  }
  const project = projectFor(asSetupErrorOf(() => loadProjects(root)), origin);
  // Test data: --data names an intent to borrow from; otherwise the matched project's own, else the demo shop's.
  const inputs = values.data || !project?.inputs ? loadIntent(resolve(values.data ?? join(root, 'intents', 'checkout.json'))).inputs : project.inputs;
  const store = project ? (Object.keys(project.stores)[0] ?? 'orders') : 'orders';
  const { intent, notes } = typedIntent(goal, inputs, await fetchCatalog(origin, fetch, project?.catalog), store);
  // Each project keeps its own learned steps: the same sentence on two apps must not share a plan.
  if (project) intent.id = intent.id.replace(/^typed-/, `typed-${project.id}-`);
  // Typed goals are scratch tests (git-ignored, caches included) unless saved as a real intent.
  if (values.save) intent.id = intent.id.replace(/^typed-/, '');
  const file = values.save ? join(root, 'intents', `${intent.id}.json`) : join(root, 'runs', 'typed', `${intent.id}.json`);
  if (values.save && existsSync(file)) throw new SetupError(`intents/${intent.id}.json already exists; it is already a test (pnpm engine run --intent intents/${intent.id}.json)`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(intent, null, 2)}\n`);
  const label = relative(root, file).replace(/\\/g, '/');
  console.log(`goal: "${goal}"`);
  console.log(project ? `  project: ${project.name} (projects/${project.id}.json): its store is the source of truth` : `  project: none in projects/ matches ${origin}; without a readable store the result is tagged unverified`);
  for (const note of notes) console.log(`  ${note}`);
  console.log(`  intent written to ${label}${values.save ? ' (saved as a test you can commit)' : ' (a scratch test; --save keeps it under intents/)'}\n`);
  const mode = llmMode(values['llm-mode']) ?? 'live';
  try {
    // A site with no source of truth does not stop the run: it can pass, tagged unverified, never GREEN.
    const result = await runGoal({
      intentFile: file,
      target: values.target,
      headed: values.headed,
      slowMo: slowMoOf(values['slow-mo']),
      // A sentence nobody typed before has nothing recorded: plan it with the model.
      envOverride: { LLM_MODE: mode },
    });
    return isVerified(result) ? exitCodeFor(result.verdict) : passedUnverified(result) ? 0 : 2;
  } catch (error) {
    if (error instanceof SetupError && /needs a model/.test(error.message)) {
      throw new SetupError(`${error.message}\nA new goal is planned by the model: put LLM_API_KEY (and the models) in .env. The recorded demo needs none.`);
    }
    throw error;
  }
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
      'same-url': { type: 'boolean', default: false },
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
    sameUrl: values['same-url'],
    // The demo runs from the recorded cache unless asked otherwise: no key, no network, the same replies every time.
    envOverride: { LLM_MODE: llmMode(values['llm-mode']) ?? 'replay' },
    quiet: false,
  });
  return result.problems.length === 0 ? 0 : 1;
}

/**
 * A goal on any website, with no verifier: the engine plans, acts and heals as usual. Exit 0 (passed, tagged
 * unverified) when every step ran and the engine believes the goal was reached, 2 otherwise.
 */
async function explore(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      input: { type: 'string', multiple: true, default: [] },
      headless: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
      'llm-mode': { type: 'string' },
    },
  });
  const goal = positionals.join(' ').trim();
  if (goal.length < 10) {
    throw new SetupError('explore needs the goal as one sentence, e.g. pnpm engine explore "search for the query and add the first result to the cart" --target https://www.example.com --input query="water bottle"');
  }
  if (!values.target) throw new SetupError('explore needs --target <url>, the website to explore');
  let intent;
  try {
    intent = exploreIntent(goal, parseInputs(values.input));
  } catch (error) {
    throw new SetupError(error instanceof Error ? error.message : String(error));
  }
  console.log(`goal: "${goal}"`);
  console.log(`  explore mode: no source of truth is read, so the result is tagged unverified`);
  console.log(`  words it may type: ${Object.keys(intent.inputs).length > 0 ? Object.keys(intent.inputs).join(', ') : 'none (add --input query="..." if the goal needs typing)'}\n`);
  try {
    const result = await exploreGoal({
      intent,
      target: values.target,
      headed: !values.headless,
      slowMo: values['slow-mo'] === undefined ? DEMO_SLOW_MO_MS : slowMoOf(values['slow-mo']),
      // A new site has nothing recorded: plan it with the model.
      envOverride: { LLM_MODE: llmMode(values['llm-mode']) ?? 'live' },
    });
    return passedUnverified(result) ? 0 : 2;
  } catch (error) {
    if (error instanceof SetupError && /needs a model/.test(error.message)) {
      throw new SetupError(`${error.message}\nExplore mode plans with the model: put LLM_API_KEY (and the models) in .env.`);
    }
    throw error;
  }
}

function asSetupErrorOf<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw new SetupError(error instanceof Error ? error.message : String(error));
  }
}

/** Lists projects/*.json and, given a URL, which project (and so which source of truth) a run there would load. */
function projectsCommand(args: string[]): number {
  const projects = asSetupErrorOf(() => loadProjects(findRepoRoot()));
  if (projects.length === 0) console.log('no projects in projects/: every run reads <target>/api/<store>');
  for (const project of projects) {
    const stores = Object.entries(project.stores).map(([name, store]) =>
      store.kind === 'browser-storage' ? `${name} in the browser's localStorage["${store.key}"]` : `${name} at ${store.baseUrl ?? '<target>'}${store.list}`,
    );
    console.log(`${project.id}: ${project.name}
  matches ${project.match.join(', ')}
  stores ${stores.join('; ')}${project.catalog ? `
  catalogue ${project.catalog.items ? `${project.catalog.items.length} products in the project file` : project.catalog.list}` : ''}`);
  }
  const [url] = args;
  if (url) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new SetupError(`not a URL: "${url}"`);
    }
    const project = projectFor(projects, origin);
    console.log(project ? `
${origin} loads ${project.id}` : `
${origin} matches no project: runs read ${origin}/api/<store>, and goals typed with try are tagged unverified if there is none`);
  }
  return 0;
}

/** The web app on 127.0.0.1, until Ctrl+C. */
async function ui(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      port: { type: 'string', default: '4321' },
      'no-open': { type: 'boolean', default: false },
      headless: { type: 'boolean', default: false },
      'slow-mo': { type: 'string' },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SetupError(`--port must be a port number (got "${values.port}")`);
  const openInBrowser = (url: string) => {
    if (values['no-open']) return;
    const [command, ...rest] = process.platform === 'win32' ? ['cmd', '/c', 'start', '""', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
    spawn(command, rest, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => undefined).unref();
  };
  // Opening the app twice must not fail: if HackWave already serves this port, show that one; if something else holds
  // it, take the next free port.
  const options = { headed: !values.headless, slowMo: values['slow-mo'] === undefined ? DEMO_SLOW_MO_MS : slowMoOf(values['slow-mo']) };
  let server: Awaited<ReturnType<typeof startUiServer>> | null = null;
  for (let candidate = port; candidate < port + 10 && !server; candidate++) {
    try {
      server = await startUiServer({ port: candidate, ...options });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) throw new SetupError(String(error));
      const running = await fetch(`http://localhost:${candidate}/api/state`, { signal: AbortSignal.timeout(2000) })
        .then(async (response) => (response.ok ? ((await response.json()) as { defaultGoal?: unknown }) : null))
        .catch(() => null);
      if (running && typeof running.defaultGoal === 'string') {
        console.log(`HackWave is already running at http://localhost:${candidate}; opening it instead of starting a second copy.`);
        openInBrowser(`http://localhost:${candidate}`);
        return 0;
      }
      console.log(`port ${candidate} is used by another program; trying ${candidate + 1}`);
    }
  }
  if (!server) throw new SetupError(`ports ${port} to ${port + 9} are all in use; pick another with --port`);
  console.log(`HackWave web app: ${server.url}  (Ctrl+C to stop)`);
  openInBrowser(server.url);
  await new Promise<void>((resolveStop) => {
    // Ctrl+C, a kill, or closing the console window (SIGHUP on Windows): stop the app's shop with it.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, resolveStop);
  });
  await server.close();
  return 0;
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

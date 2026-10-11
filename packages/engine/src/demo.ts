import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { Verdict } from '@hackwave/contracts';
import { loadConfig } from './config';
import { bold, cyan, dim, green, red, yellow } from './console';
import { markdownToHtml } from './html';
import { findRepoRoot } from './paths';
import { banner } from './report';
import { runIntent, SetupError } from './run';
import { resetStore, shopProblem, startPrivateShop, type PrivateShop } from './shop-process';
import { captureCaches, putBackCaches, restoreSnapshot } from './snapshot';

/** The caches as act 1 leaves them: the v1 plan built from the goal, and v1-warm locators. */
export const DEMO_SNAPSHOT = 'post-act-1';
/** The whole demo, in replay, fits in this (docs/BUILD.md). */
export const DEMO_BUDGET_MS = 240_000;
const DEMO_INTENT = join('intents', 'checkout.json');

type Target = 'v1' | 'v2' | 'v2-broken' | 'v2-wrong-total';

export interface Act {
  act: number;
  target: Target;
  title: string;
  expect: { color: Verdict['color']; kind: Verdict['kind']; maxLlmCalls?: number; heals?: number; minReplans?: number };
  /** The presenter's line (docs/BUILD.md, demo script). */
  cue: string;
}

/** Four acts in a fixed order: each act's cache state is the one the act before it left. */
export const ACTS: readonly Act[] = [
  {
    act: 1,
    target: 'v1',
    title: 'a normal test: the plan built from the goal, every step on rung 1',
    expect: { color: 'GREEN', kind: 'passed', maxLlmCalls: 0, heals: 0 },
    cue: 'This is a normal test. Boring on purpose.',
  },
  {
    act: 2,
    target: 'v2',
    title: 'the redesign: renamed buttons heal, the flow reorders, a new required field is re-planned',
    expect: { color: 'AMBER', kind: 'ui_drift', minReplans: 1 },
    cue: 'Three broken selectors, a reordered flow, a new required field. Zero engineer-hours. And it wrote the fix.',
  },
  {
    act: 3,
    target: 'v2-broken',
    title: 'the real bug: same UI, the page confirms the order, the store has nothing',
    expect: { color: 'RED', kind: 'real_bug', heals: 0 },
    cue: 'Same UI. The page says confirmed. The store says nothing was saved. An agent would have passed this.',
  },
  {
    act: 4,
    target: 'v2',
    title: 'the re-run: the cache learned',
    expect: { color: 'GREEN', kind: 'passed', maxLlmCalls: 0, heals: 0 },
    cue: 'Healing is a one-time cost. The cache learned.',
  },
];

/** The reserve act for "what else does it catch": the order is saved at the wrong price. */
export const WRONG_TOTAL_ACT: Act = {
  act: 5,
  target: 'v2-wrong-total',
  title: 'one more bug: the order is saved, at the wrong price',
  expect: { color: 'RED', kind: 'real_bug', heals: 0 },
  cue: 'Saved, but at the wrong price: the store says 999, the intent says 1299. The page never noticed.',
};

export interface DemoOptions {
  headed: boolean;
  slowMo: number;
  /** Record each act's browser to video.webm in its run folder. */
  video: boolean;
  /** Print the presenter's line before each act. */
  cues: boolean;
  /** Leave the caches as act 4 left them, instead of putting them back. */
  keepCaches: boolean;
  withWrongTotal: boolean;
  /** Laid over process.env for every act: LLM_MODE=replay, and for the replay-complete fixture no keys at all. */
  envOverride: Record<string, string | undefined>;
  /** Print nothing: the eval runner reports. */
  quiet: boolean;
}

export interface ActResult {
  act: Act;
  verdict: Verdict;
  runDir: string;
  ms: number;
  problems: string[];
}

export interface DemoResult {
  acts: ActResult[];
  ms: number;
  /** runs/demo-<time>/: index.html linking every act's report.html (and video). */
  folder: string;
  problems: string[];
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const minutes = (ms: number) => `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;

/** Calls a replay could not serve show up in events.jsonl: a hypothesis skipped for a cache miss, or a stop. */
function replayMisses(runDir: string): string[] {
  const file = join(runDir, 'events.jsonl');
  if (!existsSync(file)) return [];
  const misses: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const event = JSON.parse(line) as { type: string; reason?: string; code?: string; message?: string };
    if (event.type === 'explain_skipped' && /replay cache/.test(event.reason ?? '')) misses.push('the RED hypothesis is not in the replay cache');
    if (event.type === 'stopped' && event.code === 'replay_cache_miss') misses.push(event.message ?? 'replay cache miss');
  }
  return misses;
}

function actProblems(act: Act, verdict: Verdict, runDir: string): string[] {
  const problems: string[] = [];
  const { expect } = act;
  if (verdict.color !== expect.color || verdict.kind !== expect.kind) problems.push(`got ${banner(verdict)}, expected ${expect.color} · ${expect.kind}`);
  if (expect.maxLlmCalls !== undefined && verdict.llmCalls.total > expect.maxLlmCalls) problems.push(`${verdict.llmCalls.total} model calls, expected at most ${expect.maxLlmCalls}`);
  if (expect.heals !== undefined && verdict.heals.length !== expect.heals) problems.push(`${verdict.heals.length} heals, expected ${expect.heals}`);
  if (expect.minReplans !== undefined && verdict.replans.length < expect.minReplans) problems.push(`${verdict.replans.length} re-plans, expected at least ${expect.minReplans}`);
  return [...problems, ...replayMisses(runDir)];
}

function writeIndex(folder: string, results: ActResult[], ms: number, problems: string[]): string {
  mkdirSync(folder, { recursive: true });
  const link = (runDir: string, file: string) => (existsSync(join(runDir, file)) ? `[${file}](../${basename(runDir)}/${file})` : '—');
  const ok = problems.length === 0;
  const markdown = [
    `# ${ok ? 'GREEN · demo ran as scripted' : 'RED · demo did not run as scripted'}`,
    '',
    `> ${results.length} acts in ${minutes(ms)} (the budget is ${minutes(DEMO_BUDGET_MS)}). These pages are the fallback if the live demo fails.`,
    '',
    '| Act | Target | Verdict | Heals | Re-plans | Model calls | Time | Report | Video |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.act.act} | ${result.act.target} | ${banner(result.verdict)} | ${result.verdict.heals.length} | ${result.verdict.replans.length} | ${result.verdict.llmCalls.total} | ${seconds(result.ms)} | ${link(result.runDir, 'report.html')} | ${link(result.runDir, 'video.webm')} |`,
    ),
    '',
    ...(ok ? [] : ['## Problems', '', ...problems.map((problem) => `- ${problem}`), '']),
    '## The script',
    '',
    ...results.map((result) => `- Act ${result.act.act}, ${result.act.target}: ${result.act.title}. "${result.act.cue}"`),
    '',
  ].join('\n');
  writeFileSync(join(folder, 'index.md'), markdown);
  const file = join(folder, 'index.html');
  writeFileSync(file, markdownToHtml(markdown, 'Demo'));
  return file;
}

/**
 * The demo: checks the three shops, restores the post-act-1 snapshot, then runs the acts in order on fresh
 * stores, each act starting from the caches the one before it left. Caches are put back afterwards.
 */
export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  const root = findRepoRoot();
  const config = loadConfig(root);
  const log = (text: string) => {
    if (!options.quiet) console.log(text);
  };
  const ports = config.shop.ports as Record<string, number | undefined>;
  const originOf = (target: string) => {
    const port = ports[target];
    if (port === undefined) throw new SetupError(`no port for ${target} in engine.config.json`);
    return `http://localhost:${port}`;
  };
  const problemsBefore = (await Promise.all(['v1', 'v2', 'v2-broken'].map((target) => shopProblem(originOf(target), target)))).filter((problem) => problem !== null);
  if (problemsBefore.length > 0) throw new SetupError(`the demo needs the three shops:\n  ${problemsBefore.join('\n  ')}`);

  const acts = options.withWrongTotal ? [...ACTS, WRONG_TOTAL_ACT] : [...ACTS];
  const saved = captureCaches(root);
  const started = Date.now();
  const folder = join(root, 'runs', `demo-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
  const results: ActResult[] = [];
  let shop: PrivateShop | null = null;
  try {
    const restored = restoreSnapshot(root, DEMO_SNAPSHOT);
    log(dim(`demo: caches restored from runs/snapshots/${DEMO_SNAPSHOT} (${restored.join(', ')}); each store is reset before its act`));
    for (const act of acts) {
      let origin: string;
      if (act.target === 'v2-wrong-total') {
        shop = await startPrivateShop(root, act.target);
        origin = shop.origin;
      } else origin = originOf(act.target);
      await resetStore(origin);
      log('');
      log(cyan(bold(`━━━━ Act ${act.act} of ${acts.length} · ${act.target} · ${act.title} ━━━━`)));
      if (options.cues) log(yellow(`say: "${act.cue}"`));
      const actStarted = Date.now();
      const result = await runIntent({
        intentFile: join(root, DEMO_INTENT),
        target: origin,
        headed: options.headed,
        slowMo: options.slowMo,
        video: options.video,
        quiet: options.quiet,
        envOverride: options.envOverride,
      });
      results.push({ act, verdict: result.verdict, runDir: result.runDir, ms: Date.now() - actStarted, problems: actProblems(act, result.verdict, result.runDir) });
      if (shop) {
        await shop.stop();
        shop = null;
      }
    }
  } finally {
    if (shop) await shop.stop();
    if (!options.keepCaches) putBackCaches(root, saved);
  }

  const ms = Date.now() - started;
  const problems = results.flatMap((result) => result.problems.map((problem) => `act ${result.act.act}: ${problem}`));
  if (ms > DEMO_BUDGET_MS) problems.push(`the demo took ${minutes(ms)}, over its ${minutes(DEMO_BUDGET_MS)}`);
  const index = writeIndex(folder, results, ms, problems);

  log('');
  log((problems.length === 0 ? green : red)(bold(`━━━━ demo: ${results.length} acts in ${minutes(ms)} (budget ${minutes(DEMO_BUDGET_MS)}) ━━━━`)));
  for (const result of results) {
    const mark = result.problems.length === 0 ? green('✓') : red('✗');
    const calls = `${result.verdict.llmCalls.total} model call(s)${result.verdict.llmCalls.cached ? `, ${result.verdict.llmCalls.cached} from cache` : ''}`;
    log(`  ${mark} act ${result.act.act}  ${result.act.target.padEnd(14)} ${banner(result.verdict).padEnd(18)} heals ${result.verdict.heals.length} · re-plans ${result.verdict.replans.length} · ${calls} · ${seconds(result.ms)}`);
    for (const problem of result.problems) log(red(`      ${problem}`));
  }
  if (ms > DEMO_BUDGET_MS) log(red(`  over budget: ${minutes(ms)}`));
  log(dim(`  fallback pages: ${relative(root, index)} (every act's report.html${options.video ? ' and video' : ''})`));
  log(dim(options.keepCaches ? '  caches left as act 4 left them (--keep-caches)' : '  caches put back to how they were before the demo'));
  return { acts: results, ms, folder, problems };
}

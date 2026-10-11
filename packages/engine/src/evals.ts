import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VerdictColorSchema, VerdictKindSchema, type Verdict } from '@hackwave/contracts';
import { z } from 'zod';
import { loadConfig, type EngineConfig } from './config';
import { bold, dim, green, red, yellow } from './console';
import { loadIntent } from './load';
import { locatorCacheFile } from './locator-cache';
import { findRepoRoot } from './paths';
import { planCacheFile } from './plan-cache';
import { banner, healerLine } from './report';
import { runIntent, SetupError, type PlanSourceKind, type RunResult } from './run';
import { runDemo } from './demo';
import { resetStore, startPrivateShop, type PrivateShop } from './shop-process';
import { captureCaches, putBackCaches, restoreSnapshot } from './snapshot';

const CHECKS = ['state', 'binding', 'alerts'] as const;
/** Pause between live provider-switch profiles on the same host, so its per-minute token limit refills. */
const SAME_HOST_COOLDOWN_MS = 60_000;

const ExpectSchema = z.strictObject({
  color: VerdictColorSchema,
  kind: VerdictKindSchema.optional(),
  /** Exactly these oracle checks fail. */
  failedChecks: z.array(z.enum(CHECKS)).optional(),
  /** Each code appears among the verdict reasons. */
  reasonCodes: z.array(z.string()).optional(),
  /** Each string appears in the verdict reason messages. */
  messageIncludes: z.array(z.string()).optional(),
  healerBelievedDone: z.boolean().optional(),
  heals: z.number().int().nonnegative().optional(),
  replans: z.number().int().nonnegative().optional(),
  /** At least this many rung-5 re-plans. */
  minReplans: z.number().int().positive().optional(),
  maxLlmCalls: z.number().int().nonnegative().optional(),
  planSource: z.enum(['hand-written', 'cache', 'planner']).optional(),
  /** At least this many heals on each listed rung, e.g. {"2": 1, "3": 1}. */
  minHealsAtRung: z.partialRecord(z.enum(['2', '3', '4', '5']), z.number().int().positive()).optional(),
  /** Each string appears in the run's report.md. */
  reportIncludes: z.array(z.string()).optional(),
});
type Expect = z.infer<typeof ExpectSchema>;

const FixtureSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  /** The phase that makes this fixture runnable; listed, not failed, until then. */
  pending: z.string().optional(),
  intent: z.string(),
  target: z.enum(['v1', 'v2', 'v2-broken', 'v2-wrong-total']).optional(),
  /** Start a private shop for this fixture instead of using the configured port. */
  privateShop: z.boolean().default(false),
  /** Kill the private shop right after this step's action. */
  killAfterStep: z.string().optional(),
  plan: z.string().optional(),
  /**
   * Cache state before the run: empty (plan and locator caches cleared), committed (as they were when the eval
   * started, i.e. the committed files), snapshot:<name> (runs/snapshots/<name>), after:<fixture> (left as that
   * fixture left it).
   */
  cache: z.union([z.enum(['empty', 'committed']), z.string().regex(/^(after|snapshot):[a-z0-9-]+$/)]).optional(),
  /** Run once per provider that has a key and model in .env, in live mode; providers without one are skipped. */
  providerSwitch: z.boolean().default(false),
  /** Run the whole demo (all acts, their own expectations) in replay with no API key, instead of one intent. */
  demo: z.boolean().default(false),
  /** For a demo fixture: the most it may take, end to end. */
  maxSeconds: z.number().int().positive().optional(),
  expect: ExpectSchema.optional(),
}).refine((fixture) => fixture.demo || fixture.expect !== undefined, 'a fixture needs "expect" unless it is a demo fixture');
type Fixture = z.infer<typeof FixtureSchema>;

/** Every LLM variable blanked: what a fresh clone with no .env has. Replay must not need any of them. */
const NO_LLM_ENV: Record<string, string | undefined> = {
  LLM_MODE: 'replay',
  LLM_PROVIDER: undefined,
  LLM_API_KEY: undefined,
  LLM_BASE_URL: undefined,
  LLM_MODEL_STRONG: undefined,
  LLM_MODEL_FAST: undefined,
  LLM_PROVIDER_FAST: undefined,
  LLM_API_KEY_FAST: undefined,
};

function compare(expect: Expect, verdict: Verdict, planSource: PlanSourceKind, report: string): string[] {
  const problems: string[] = [];
  if (verdict.color !== expect.color) problems.push(`color ${verdict.color}, expected ${expect.color}`);
  if (expect.kind && verdict.kind !== expect.kind) problems.push(`kind ${verdict.kind}, expected ${expect.kind}`);
  if (expect.failedChecks) {
    const failed = CHECKS.filter((name) => verdict.oracle[name].status === 'fail');
    const wanted = CHECKS.filter((name) => expect.failedChecks?.includes(name));
    if (failed.join() !== wanted.join()) problems.push(`failed checks [${failed.join(', ')}], expected [${wanted.join(', ')}]`);
  }
  for (const code of expect.reasonCodes ?? []) {
    if (!verdict.reasons.some((reason) => reason.code === code)) problems.push(`no reason with code ${code}`);
  }
  const messages = verdict.reasons.map((reason) => reason.message).join('\n');
  for (const text of expect.messageIncludes ?? []) {
    if (!messages.includes(text)) problems.push(`reasons do not mention "${text}"`);
  }
  if (expect.healerBelievedDone !== undefined && verdict.healerBelievedDone.believed !== expect.healerBelievedDone) {
    problems.push(`healerBelievedDone ${verdict.healerBelievedDone.believed}, expected ${expect.healerBelievedDone}`);
  }
  if (expect.heals !== undefined && verdict.heals.length !== expect.heals) problems.push(`${verdict.heals.length} heals, expected ${expect.heals}`);
  if (expect.replans !== undefined && verdict.replans.length !== expect.replans) {
    problems.push(`${verdict.replans.length} re-plans, expected ${expect.replans}`);
  }
  if (expect.minReplans !== undefined && verdict.replans.length < expect.minReplans) {
    problems.push(`${verdict.replans.length} re-plan(s), expected at least ${expect.minReplans}`);
  }
  for (const text of expect.reportIncludes ?? []) {
    if (!report.includes(text)) problems.push(`report.md does not mention "${text}"`);
  }
  if (expect.maxLlmCalls !== undefined && verdict.llmCalls.total > expect.maxLlmCalls) {
    problems.push(`${verdict.llmCalls.total} LLM calls, expected at most ${expect.maxLlmCalls}`);
  }
  for (const [rung, minimum] of Object.entries(expect.minHealsAtRung ?? {})) {
    const count = verdict.heals.filter((heal) => String(heal.rung) === rung).length;
    if (count < (minimum ?? 0)) problems.push(`${count} heal(s) on rung ${rung}, expected at least ${minimum}`);
  }
  if (expect.planSource !== undefined && planSource !== expect.planSource) problems.push(`plan came from ${planSource}, expected ${expect.planSource}`);
  return problems;
}

function readReport(runDir: string): string {
  const file = join(runDir, 'report.md');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function loadFixtures(root: string): Fixture[] {
  const file = join(root, 'evals', 'fixtures.json');
  const parsed = z.array(FixtureSchema).safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) throw new SetupError(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export interface SwitchProfile {
  provider: string;
  model: string | undefined;
  apiKey: string | undefined;
  /** This profile's base URL; undefined means the registry default. */
  baseUrl: string | undefined;
  skip: string | null;
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * One profile per provider in the registry, from LLM_SWITCH_<PROVIDER>_MODEL, _API_KEY and _BASE_URL, plus the
 * main LLM_PROVIDER profile from .env. A profile without its own key reuses the main key only when it points at
 * the same host the main key already goes to: a key is never sent to another host.
 */
export function switchProfiles(config: EngineConfig, env: Readonly<Record<string, string | undefined>>): SwitchProfile[] {
  const value = (key: string) => {
    const text = env[key]?.trim();
    return text && text !== 'replace-me' ? text : undefined;
  };
  const main = value('LLM_PROVIDER') ?? config.llm.provider;
  const mainKey = value('LLM_API_KEY');
  const mainHost = hostOf(value('LLM_BASE_URL') ?? config.llm.baseUrl ?? config.llm.providers[main]?.baseUrl);
  return Object.entries(config.llm.providers).map(([provider, entry]) => {
    const prefix = `LLM_SWITCH_${provider.toUpperCase().replace(/-/g, '_')}`;
    const isMain = provider === main;
    const model = value(`${prefix}_MODEL`) ?? (isMain ? value('LLM_MODEL_STRONG') : undefined);
    const baseUrl = value(`${prefix}_BASE_URL`) ?? (isMain ? value('LLM_BASE_URL') : undefined);
    const host = hostOf(baseUrl ?? entry.baseUrl);
    const sameHostAsMainKey = mainKey !== undefined && host !== null && host === mainHost;
    const apiKey = value(`${prefix}_API_KEY`) ?? (isMain || sameHostAsMainKey ? mainKey : undefined);
    const skip = !model
      ? `no ${prefix}_MODEL`
      : host === null
        ? `no ${prefix}_BASE_URL`
        : entry.needsKey && !apiKey
          ? `no ${prefix}_API_KEY`
          : null;
    return { provider, model, apiKey, baseUrl, skip };
  });
}


/**
 * The test for the test tool: reset the target store, set the cache state, run the intent, compare the
 * verdict and the listed conditions. Any mismatch fails the eval; pending fixtures are listed until their phase.
 * Plan and locator caches are put back afterwards unless keepCaches is set; recorded model calls are kept.
 */
export async function runEvals(options: {
  only?: string[];
  verbose?: boolean;
  llmMode?: string;
  keepCaches?: boolean;
  /** Show each fixture's browser, optionally slowed down. */
  headed?: boolean;
  slowMo?: number;
}): Promise<number> {
  const root = findRepoRoot();
  const config = loadConfig(root);
  const fixtures = loadFixtures(root);
  const wanted = options.only ?? [];
  const unknown = wanted.filter((name) => !fixtures.some((fixture) => fixture.name === name));
  if (unknown.length > 0) throw new SetupError(`no fixture named ${unknown.map((name) => `"${name}"`).join(', ')}`);
  const selected = wanted.length > 0 ? fixtures.filter((fixture) => wanted.includes(fixture.name)) : fixtures;
  const modeOverride: Record<string, string> = options.llmMode ? { LLM_MODE: options.llmMode } : {};
  // Taken always: "committed" fixtures start from it. Put back at the end unless keepCaches.
  const savedCaches = captureCaches(root);
  try {
    const view = { verbose: options.verbose ?? false, headed: options.headed ?? false, slowMo: options.slowMo ?? 0 };
    return await runSelected(root, config, selected, modeOverride, view, savedCaches);
  } finally {
    if (!options.keepCaches) putBackCaches(root, savedCaches);
  }
}

async function runSelected(
  root: string,
  config: EngineConfig,
  selected: Fixture[],
  modeOverride: Record<string, string>,
  options: { verbose: boolean; headed: boolean; slowMo: number },
  committed: ReadonlyMap<string, string>,
): Promise<number> {
  console.log(bold(`eval: ${selected.length} fixture(s)`));
  let passed = 0;
  let failed = 0;
  let pending = 0;

  const report = (name: string, result: RunResult, problems: string[], started: number) => {
    const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
    const llm = result.verdict.llmCalls.total > 0 ? ` · ${result.verdict.llmCalls.total} LLM call(s)${result.verdict.llmCalls.cached ? `, ${result.verdict.llmCalls.cached} cached` : ''}` : '';
    if (problems.length === 0) {
      console.log(`${green(`  ✓ ${name}`)}  ${banner(result.verdict)} · ${healerLine(result.verdict)} · plan from ${result.planSource}${llm} (${took})`);
    } else {
      console.log(`${red(`  ✗ ${name}`)}  got ${banner(result.verdict)} · plan from ${result.planSource}${llm} (${took})`);
      for (const problem of problems) console.log(red(`      ${problem}`));
    }
    for (const reason of result.verdict.reasons) console.log(dim(`      ${reason.code}: ${reason.message}`));
    console.log(dim(`      ${relative(root, result.runDir)}`));
  };

  const ran = new Set<string>();
  for (const fixture of selected) {
    if (fixture.pending) {
      pending++;
      console.log(dim(`  - ${fixture.name}: pending until ${fixture.pending}`));
      continue;
    }
    // after:<fixture> means "as that fixture left the caches": without it in this eval, the state is whatever is on disk.
    const after = fixture.cache?.startsWith('after:') ? fixture.cache.slice('after:'.length) : null;
    if (after && !ran.has(after)) {
      failed++;
      console.log(`${red(`  ✗ ${fixture.name}`)}  not run: its cache state is after:${after}, so ${after} has to run earlier in the same eval; add it to the list`);
      continue;
    }
    ran.add(fixture.name);
    const started = Date.now();
    if (fixture.demo) {
      try {
        const result = await runDemo({ headed: options.headed, slowMo: options.slowMo, video: false, cues: false, keepCaches: false, withWrongTotal: false, envOverride: NO_LLM_ENV, quiet: !options.verbose });
        const problems = [...result.problems];
        if (fixture.maxSeconds !== undefined && result.ms > fixture.maxSeconds * 1000) problems.push(`took ${(result.ms / 1000).toFixed(0)} s, over ${fixture.maxSeconds} s`);
        const acts = result.acts.map((act) => `act ${act.act.act} ${act.verdict.color}`).join(', ');
        if (problems.length === 0) passed++;
        else failed++;
        console.log(`${(problems.length === 0 ? green : red)(`  ${problems.length === 0 ? '✓' : '✗'} ${fixture.name}`)}  ${acts} · ${(result.ms / 1000).toFixed(1)} s, replay with no API key`);
        for (const problem of problems) console.log(red(`      ${problem}`));
        console.log(dim(`      ${relative(root, result.folder)}`));
      } catch (error) {
        failed++;
        console.log(red(`  ✗ ${fixture.name}: ${error instanceof Error ? error.message : String(error)}`));
      }
      continue;
    }
    let shop: PrivateShop | null = null;
    try {
      if (!fixture.target || !fixture.expect) throw new SetupError('fixture has no target or no expect');
      const expect = fixture.expect;
      const intentFile = join(root, fixture.intent);
      const intentId = loadIntent(intentFile).id;
      const cacheFile = planCacheFile(root, intentId);
      let origin: string;
      if (fixture.privateShop || fixture.killAfterStep) {
        shop = await startPrivateShop(root, fixture.target);
        origin = shop.origin;
      } else {
        const port = (config.shop.ports as Record<string, number | undefined>)[fixture.target];
        if (port === undefined) throw new SetupError(`no port for ${fixture.target} in engine.config.json; set privateShop`);
        origin = `http://localhost:${port}`;
      }
      const run = async (envOverride: Record<string, string | undefined>) => {
        await resetStore(origin);
        if (fixture.cache === 'empty') {
          for (const file of [cacheFile, locatorCacheFile(root, intentId), locatorCacheFile(root, intentId, true)]) rmSync(file, { force: true });
        }
        if (fixture.cache === 'committed') putBackCaches(root, committed);
        if (fixture.cache?.startsWith('snapshot:')) restoreSnapshot(root, fixture.cache.slice('snapshot:'.length));
        const killAfter = fixture.killAfterStep;
        const privateShop = shop;
        return runIntent({
          intentFile,
          target: origin,
          planFile: fixture.plan ? join(root, fixture.plan) : undefined,
          quiet: !options.verbose,
          headed: options.headed,
          slowMo: options.slowMo,
          envOverride,
          afterAction: killAfter
            ? async (stepKey) => {
                if (stepKey === killAfter) await privateShop?.kill();
              }
            : undefined,
        });
      };

      if (!fixture.providerSwitch) {
        const result = await run(modeOverride);
        const problems = compare(expect, result.verdict, result.planSource, readReport(result.runDir));
        if (problems.length === 0) passed++;
        else failed++;
        report(fixture.name, result, problems, started);
        continue;
      }

      // Provider switch: live mode, once per provider with a key; the plan cache is put back afterwards.
      const savedPlan = existsSync(cacheFile) ? readFileSync(cacheFile, 'utf8') : null;
      const profiles = switchProfiles(config, process.env);
      const runnable = profiles.filter((profile) => profile.skip === null);
      let switchFailed = false;
      let lastHost: string | null = null;
      try {
        for (const profile of profiles) {
          if (profile.skip) {
            console.log(dim(`  - ${fixture.name}[${profile.provider}]: skipped (${profile.skip})`));
            continue;
          }
          // Two live runs in a row against one host share its per-minute token limit: let it refill first.
          const host = hostOf(profile.baseUrl ?? config.llm.providers[profile.provider]?.baseUrl);
          if (host !== null && host === lastHost) {
            console.log(dim(`  … waiting ${SAME_HOST_COOLDOWN_MS / 1000} s: the previous profile used ${host} too (per-minute rate limit)`));
            await new Promise((resolve) => setTimeout(resolve, SAME_HOST_COOLDOWN_MS));
          }
          lastHost = host;
          const providerStarted = Date.now();
          const result = await run({
            LLM_MODE: 'live',
            LLM_PROVIDER: profile.provider,
            LLM_API_KEY: profile.apiKey ?? '',
            LLM_MODEL_STRONG: profile.model,
            LLM_MODEL_FAST: profile.model,
            LLM_PROVIDER_FAST: '',
            LLM_API_KEY_FAST: '',
            LLM_BASE_URL: profile.baseUrl ?? '',
          });
          const problems = compare(expect, result.verdict, result.planSource, readReport(result.runDir));
          if (problems.length > 0) switchFailed = true;
          report(`${fixture.name}[${profile.provider}]`, result, problems, providerStarted);
        }
      } finally {
        if (savedPlan === null) rmSync(cacheFile, { force: true });
        else writeFileSync(cacheFile, savedPlan);
      }
      if (runnable.length === 0) {
        pending++;
        console.log(yellow(`  - ${fixture.name}: skipped, no provider has a key and model in .env`));
      } else if (switchFailed) {
        failed++;
      } else {
        passed++;
        console.log(green(`  ✓ ${fixture.name}: passed on ${runnable.length} provider(s): ${runnable.map((profile) => profile.provider).join(', ')}`));
      }
    } catch (error) {
      failed++;
      console.log(red(`  ✗ ${fixture.name}: ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      await shop?.stop();
    }
  }
  console.log(`\neval: ${passed} passed, ${failed} failed, ${pending} pending or skipped`);
  return failed === 0 ? 0 : 1;
}

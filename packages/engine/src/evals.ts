import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VerdictColorSchema, VerdictKindSchema, type Verdict } from '@hackwave/contracts';
import { z } from 'zod';
import { loadConfig, type EngineConfig } from './config';
import { bold, dim, green, red, yellow } from './console';
import { loadIntent } from './load';
import { findRepoRoot } from './paths';
import { planCacheFile } from './plan-cache';
import { banner, healerLine } from './report';
import { runIntent, SetupError, type PlanSourceKind, type RunResult } from './run';
import { startPrivateShop, type PrivateShop } from './shop-process';

const CHECKS = ['state', 'binding', 'alerts'] as const;

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
  maxLlmCalls: z.number().int().nonnegative().optional(),
  planSource: z.enum(['hand-written', 'cache', 'planner']).optional(),
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
  /** Cache state before the run: empty (plan cache cleared), after:<fixture> (left as that fixture left it). */
  cache: z.string().optional(),
  /** Run once per provider that has a key and model in .env, in live mode; providers without one are skipped. */
  providerSwitch: z.boolean().default(false),
  expect: ExpectSchema,
});
type Fixture = z.infer<typeof FixtureSchema>;

function compare(expect: Expect, verdict: Verdict, planSource: PlanSourceKind): string[] {
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
  if (expect.maxLlmCalls !== undefined && verdict.llmCalls.total > expect.maxLlmCalls) {
    problems.push(`${verdict.llmCalls.total} LLM calls, expected at most ${expect.maxLlmCalls}`);
  }
  if (expect.planSource !== undefined && planSource !== expect.planSource) problems.push(`plan came from ${planSource}, expected ${expect.planSource}`);
  return problems;
}

async function resetStore(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/_test/reset`, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch((error: unknown) => {
    throw new SetupError(`${origin} is not reachable (${error instanceof Error ? error.message : String(error)}); start the shops with pnpm shop`);
  });
  if (!response.ok) throw new SetupError(`reset on ${origin} returned HTTP ${response.status}; is SHOP_TEST_MODE=1?`);
}

function loadFixtures(root: string): Fixture[] {
  const file = join(root, 'evals', 'fixtures.json');
  const parsed = z.array(FixtureSchema).safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) throw new SetupError(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

interface SwitchProfile {
  provider: string;
  model: string | undefined;
  apiKey: string | undefined;
  skip: string | null;
}

/** LLM_SWITCH_<PROVIDER>_MODEL / _API_KEY, plus the main LLM_PROVIDER profile from .env. */
function switchProfiles(config: EngineConfig, env: NodeJS.ProcessEnv): SwitchProfile[] {
  const value = (key: string) => {
    const text = env[key]?.trim();
    return text && text !== 'replace-me' ? text : undefined;
  };
  const main = value('LLM_PROVIDER') ?? config.llm.provider;
  return Object.entries(config.llm.providers)
    .filter(([provider]) => provider !== 'custom')
    .map(([provider, entry]) => {
      const prefix = `LLM_SWITCH_${provider.toUpperCase().replace(/-/g, '_')}`;
      const model = value(`${prefix}_MODEL`) ?? (provider === main ? value('LLM_MODEL_STRONG') : undefined);
      const apiKey = value(`${prefix}_API_KEY`) ?? (provider === main ? value('LLM_API_KEY') : undefined);
      const skip = !model ? `no ${prefix}_MODEL` : entry.needsKey && !apiKey ? `no ${prefix}_API_KEY` : null;
      return { provider, model, apiKey, skip };
    });
}

/**
 * The test for the test tool: reset the target store, set the cache state, run the intent, compare the
 * verdict and the listed conditions. Any mismatch fails the eval; pending fixtures are listed until their phase.
 */
export async function runEvals(options: { only?: string; verbose?: boolean; llmMode?: string }): Promise<number> {
  const root = findRepoRoot();
  const config = loadConfig(root);
  const fixtures = loadFixtures(root);
  const selected = options.only ? fixtures.filter((fixture) => fixture.name === options.only) : fixtures;
  if (selected.length === 0) throw new SetupError(`no fixture named "${options.only ?? ''}"`);
  const modeOverride = options.llmMode ? { LLM_MODE: options.llmMode } : {};

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

  for (const fixture of selected) {
    if (fixture.pending) {
      pending++;
      console.log(dim(`  - ${fixture.name}: pending until ${fixture.pending}`));
      continue;
    }
    const started = Date.now();
    let shop: PrivateShop | null = null;
    try {
      if (!fixture.target) throw new SetupError('fixture has no target');
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
        if (fixture.cache === 'empty') rmSync(cacheFile, { force: true });
        const killAfter = fixture.killAfterStep;
        const privateShop = shop;
        return runIntent({
          intentFile,
          target: origin,
          planFile: fixture.plan ? join(root, fixture.plan) : undefined,
          quiet: !options.verbose,
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
        const problems = compare(fixture.expect, result.verdict, result.planSource);
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
      try {
        for (const profile of profiles) {
          if (profile.skip) {
            console.log(dim(`  - ${fixture.name}[${profile.provider}]: skipped (${profile.skip})`));
            continue;
          }
          const providerStarted = Date.now();
          const result = await run({
            LLM_MODE: 'live',
            LLM_PROVIDER: profile.provider,
            LLM_API_KEY: profile.apiKey ?? '',
            LLM_MODEL_STRONG: profile.model,
            LLM_MODEL_FAST: profile.model,
            LLM_PROVIDER_FAST: '',
            LLM_API_KEY_FAST: '',
            LLM_BASE_URL: '',
          });
          const problems = compare(fixture.expect, result.verdict, result.planSource);
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

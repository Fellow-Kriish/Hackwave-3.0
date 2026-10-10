import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { VerdictColorSchema, VerdictKindSchema, type Verdict } from '@hackwave/contracts';
import { z } from 'zod';
import { loadConfig } from './config';
import { bold, dim, green, red } from './console';
import { findRepoRoot } from './paths';
import { banner, healerLine } from './report';
import { runIntent, SetupError } from './run';
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
  /** Cache state before the run: empty, after:<fixture>, snapshot:<name> or committed (from P2). */
  cache: z.string().optional(),
  expect: ExpectSchema,
});
type Fixture = z.infer<typeof FixtureSchema>;

function compare(expect: Expect, verdict: Verdict): string[] {
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

/**
 * The test for the test tool: reset the target store, run the intent, compare the verdict and the listed
 * conditions. Any mismatch fails the eval; pending fixtures are listed until their phase arrives.
 */
export async function runEvals(options: { only?: string; verbose?: boolean }): Promise<number> {
  const root = findRepoRoot();
  const config = loadConfig(root);
  const fixtures = loadFixtures(root);
  const selected = options.only ? fixtures.filter((fixture) => fixture.name === options.only) : fixtures;
  if (selected.length === 0) throw new SetupError(`no fixture named "${options.only ?? ''}"`);

  console.log(bold(`eval: ${selected.length} fixture(s)`));
  let passed = 0;
  let failed = 0;
  let pending = 0;
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
      let origin: string;
      if (fixture.privateShop || fixture.killAfterStep) {
        shop = await startPrivateShop(root, fixture.target);
        origin = shop.origin;
      } else {
        const port = (config.shop.ports as Record<string, number | undefined>)[fixture.target];
        if (port === undefined) throw new SetupError(`no port for ${fixture.target} in engine.config.json; set privateShop`);
        origin = `http://localhost:${port}`;
      }
      await resetStore(origin);
      const killAfter = fixture.killAfterStep;
      const privateShop = shop;
      const { verdict, runDir } = await runIntent({
        intentFile: join(root, fixture.intent),
        target: origin,
        planFile: fixture.plan ? join(root, fixture.plan) : undefined,
        quiet: !options.verbose,
        afterAction: killAfter
          ? async (stepKey) => {
              if (stepKey === killAfter) await privateShop?.kill();
            }
          : undefined,
      });
      const problems = compare(fixture.expect, verdict);
      const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
      if (problems.length === 0) {
        passed++;
        console.log(`${green(`  ✓ ${fixture.name}`)}  ${banner(verdict)} · ${healerLine(verdict)} (${took})`);
      } else {
        failed++;
        console.log(`${red(`  ✗ ${fixture.name}`)}  got ${banner(verdict)} (${took})`);
        for (const problem of problems) console.log(red(`      ${problem}`));
      }
      for (const reason of verdict.reasons) console.log(dim(`      ${reason.code}: ${reason.message}`));
      console.log(dim(`      ${relative(root, runDir)}`));
    } catch (error) {
      failed++;
      console.log(red(`  ✗ ${fixture.name}: ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      await shop?.stop();
    }
  }
  console.log(`\neval: ${passed} passed, ${failed} failed, ${pending} pending`);
  return failed === 0 ? 0 : 1;
}

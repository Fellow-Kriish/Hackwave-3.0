import { writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  emptyRungHistogram,
  flattenInputs,
  planInputProblems,
  redactForHealer,
  sha256,
  type Budgets,
  type RunRecord,
  type Verdict,
} from '@hackwave/contracts';
import { createVerifier, decideVerdict } from '@hackwave/verifier';
import { chromium } from 'playwright';
import { sameOrigin } from './allowlist';
import { loadConfig } from './config';
import { printEvent } from './console';
import { EventLog } from './events';
import { execute, type ExecutionResult } from './executor';
import { loadIntent, loadPlan } from './load';
import { findRepoRoot } from './paths';
import { printFinalBlock, renderReport } from './report';
import { createRunDir } from './run-dir';
import { Timings } from './timing';

/** Something is wrong before the run can start (bad files, server down). Reported as a setup error, never GREY. */
export class SetupError extends Error {
  override readonly name = 'SetupError';
}

export interface RunOptions {
  intentFile: string;
  /** URL of the app under test, e.g. http://localhost:5171 */
  target: string;
  planFile?: string;
  headed?: boolean;
  slowMo?: number;
  /** Suppress the console stream and final block (evals print their own summary). */
  quiet?: boolean;
  /** Eval hook, awaited after every action. */
  afterAction?: (stepKey: string) => Promise<void>;
}

export interface RunResult {
  verdict: Verdict;
  runDir: string;
}

/** Grace on top of the run budget before the watchdog declares a hang. */
const WATCHDOG_GRACE_MS = 15_000;

/** GREEN and AMBER pass; RED fails; GREY is never a pass. */
export function exitCodeFor(verdict: Verdict): number {
  return verdict.color === 'GREEN' || verdict.color === 'AMBER' ? 0 : verdict.color === 'RED' ? 1 : 2;
}

function parseTarget(target: string): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new SetupError(`--target must be a URL such as http://localhost:5171 (got "${target}")`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SetupError(`--target must be http or https (got ${url.protocol})`);
  return url;
}

async function preflight(url: URL): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
    const why = cause ? cause.message || (cause as NodeJS.ErrnoException).code || cause.name : String(error);
    throw new SetupError(`${url.origin} is not reachable (${why}). Start the shops (pnpm shop) and run pnpm engine doctor.`);
  }
}

export async function runIntent(options: RunOptions): Promise<RunResult> {
  const root = findRepoRoot();
  const config = loadConfig(root);
  const intentFile = resolve(options.intentFile);
  const intent = (() => {
    try {
      return loadIntent(intentFile);
    } catch (error) {
      throw new SetupError(error instanceof Error ? error.message : String(error));
    }
  })();
  if (!options.planFile) {
    throw new SetupError('no --plan given. The planner arrives in P2; until then pass a hand-written plan, e.g. evals/plans/checkout.v1.json');
  }
  const planFile = resolve(options.planFile);
  const plan = (() => {
    try {
      return loadPlan(planFile);
    } catch (error) {
      throw new SetupError(error instanceof Error ? error.message : String(error));
    }
  })();

  // The engine boundary: the executor gets goal + input keys (and values by key); only the verifier gets the oracle.
  const healer = redactForHealer(intent);
  const inputs = flattenInputs(intent.inputs);
  const problems = planInputProblems(plan, healer.inputKeys);
  if (problems.length > 0) throw new SetupError(`the plan does not fit the intent:\n  ${problems.join('\n  ')}`);

  const targetUrl = parseTarget(options.target);
  const origin = targetUrl.origin;
  await preflight(targetUrl);

  const budgets: Budgets = { ...config.budgets, ...intent.budgets };
  const runDir = createRunDir(join(root, 'runs'), intent.id, targetUrl.toString());
  const runId = basename(runDir);
  const planLabel = relative(root, planFile).replace(/\\/g, '/');
  const planSource = plan.promptHash === 'hand-written' ? 'hand-written' : 'planner';
  const writeJson = (file: string, value: unknown) => writeFileSync(join(runDir, file), `${JSON.stringify(value, null, 2)}\n`);
  writeJson('config-used.json', { ...config, budgets, intentBudgetOverrides: intent.budgets ?? {} });
  writeJson('plan-used.json', plan);

  const events = new EventLog(join(runDir, 'events.jsonl'));
  if (!options.quiet) events.onEvent(printEvent);
  const timings = new Timings();
  const startedAt = new Date().toISOString();
  events.emit('run_started', { runId, intentId: intent.id, target: targetUrl.toString(), plan: planLabel, planSource, budgets });
  if (plan.intentId !== intent.id || plan.goalHash !== sha256(intent.goal)) {
    events.emit('plan_mismatch', {
      message: `plan ${planLabel} was written for ${plan.intentId}, not ${intent.id}; its input keys fit, so it runs`,
    });
  }

  const verifier = createVerifier(intent, { origin, evidenceDir: join(runDir, 'evidence'), defaultPollMs: config.verifier.pollMs });
  let baseline;
  try {
    baseline = await verifier.baseline();
  } catch (error) {
    throw new SetupError(`cannot read the store before the run: ${error instanceof Error ? error.message : String(error)}`);
  }
  events.emit('verifier_baseline', { count: baseline.count, maxId: baseline.maxId });

  const browser = await chromium.launch({ headless: !options.headed, slowMo: options.slowMo ?? 0 });
  try {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
    // Blast radius: no HTTP outside the app.
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (sameOrigin(url, origin) || url.startsWith('data:')) return route.continue();
      events.emit('blocked_request', { url });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => {
      events.emit('dialog_dismissed', { dialogType: dialog.type() });
      void dialog.dismiss().catch(() => undefined);
    });

    let watchdog: NodeJS.Timeout | undefined;
    const hung = new Promise<ExecutionResult>((settle) => {
      watchdog = setTimeout(
        () =>
          settle({
            outcome: 'environment',
            reason: { code: 'run_timeout', message: `the run did not finish within ${budgets.runMs + WATCHDOG_GRACE_MS} ms` },
            terminalAttempted: false,
            healerBelievedDone: { believed: false, atStep: null, stepKey: null },
            actions: 0,
            lastStepKey: null,
            rungHistogram: emptyRungHistogram(),
            environmentErrors: [],
          }),
        budgets.runMs + WATCHDOG_GRACE_MS,
      );
    });
    const execution = await Promise.race([
      execute({
        page,
        origin,
        startUrl: targetUrl.toString(),
        plan,
        healer,
        inputs,
        budgets,
        settle: config.settle,
        events,
        timings,
        afterAction: options.afterAction,
      }),
      hung,
    ]).finally(() => clearTimeout(watchdog));

    const record: RunRecord = {
      runId,
      intentId: intent.id,
      target: targetUrl.toString(),
      startedAt,
      endedAt: new Date().toISOString(),
      ...execution,
      heals: [],
      replans: [],
      llmCalls: { total: 0, byModel: {} },
      tokens: { input: 0, output: 0, byModel: {} },
      timings: timings.summary(),
    };

    const oracle = await verifier.verify(page, record);
    events.emit('verifier_result', { state: oracle.state, binding: oracle.binding, alerts: oracle.alerts });
    const verdict = decideVerdict(oracle, record);
    events.emit('verdict', { color: verdict.color, kind: verdict.kind, reasons: verdict.reasons });

    const reportContext = { config: { ...config, budgets }, record, planFile: planLabel, planSource, runDir };
    writeJson('run-record.json', record);
    writeJson('verdict.json', verdict);
    writeFileSync(join(runDir, 'report.md'), renderReport(verdict, reportContext));
    if (!options.quiet) printFinalBlock(verdict, reportContext);
    return { verdict, runDir };
  } finally {
    await browser.close();
  }
}

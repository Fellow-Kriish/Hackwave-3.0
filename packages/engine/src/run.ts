import { rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  emptyRungHistogram,
  flattenInputs,
  isExpanded,
  planInputProblems,
  redactForHealer,
  sha256,
  type Budgets,
  type Intent,
  type Plan,
  type RunRecord,
  type Verdict,
} from '@hackwave/contracts';
import { createVerifier, decideVerdict } from '@hackwave/verifier';
import { chromium } from 'playwright';
import { sameOrigin } from './allowlist';
import { loadConfig } from './config';
import { printEvent } from './console';
import { EventLog, type EngineEvent } from './events';
import { execute, type ExecutionResult, type ExecutionSnapshot } from './executor';
import { describeTier, LlmAdapter, loadPrompt, readManifest, resolveLlmSettings } from './llm';
import { loadIntent, loadPlan } from './load';
import { LocatorCache } from './locator-cache';
import { findRepoRoot } from './paths';
import { cacheablePlan, loadCachedPlan, planCacheFile, savePlanCache } from './plan-cache';
import { createPlanner, planPromptHash } from './planner';
import { createExplainer, type Explanation } from './explain';
import { printExploreBlock, renderExploreReport, type ExploreResult } from './explore';
import { markdownToHtml } from './html';
import { banner, printFinalBlock, renderReport, summary, whatChanged, type LocatorChange, type ReportContext } from './report';
import { createReplanner } from './replanner';
import { createRung3Picker } from './resolver';
import { createRunDir } from './run-dir';
import { Timings } from './timing';
import { valueOwnersOf } from './tree';

/** Something is wrong before the run can start (bad files, server down, no model). A setup error, never GREY. */
export class SetupError extends Error {
  override readonly name = 'SetupError';
}

export type PlanSourceKind = 'hand-written' | 'cache' | 'planner';

export interface RunOptions {
  intentFile: string;
  /** URL of the app under test, e.g. http://localhost:5171 */
  target: string;
  /** A hand-written plan. Without it the cached plan is used, or the planner writes one. */
  planFile?: string;
  headed?: boolean;
  slowMo?: number;
  /** Record the browser to video.webm in the run folder (the demo's fallback recording). */
  video?: boolean;
  /** Suppress the console stream and final block (evals print their own summary). */
  quiet?: boolean;
  /** Eval hook, awaited after every action. */
  afterAction?: (stepKey: string) => Promise<void>;
  /** Variables laid over process.env when choosing the model (the provider-switch eval). */
  envOverride?: Record<string, string | undefined>;
  /** Every event as it happens (the web app streams them); the JSON line is on disk first. */
  onEvent?: (event: EngineEvent) => void;
}

/** A screenshot taken where the run changed course or failed, kept in the run folder for the report. */
export interface RunShot {
  /** Relative to the run folder, e.g. shots/01-checkout.proceed.png */
  file: string;
  kind: 'healed' | 'replanned' | 'unresolved' | 'stopped';
  stepKey: string | null;
  caption: string;
}

export interface RunResult {
  verdict: Verdict;
  /** Screens at every change or failure, in the order they happened. */
  shots: RunShot[];
  runDir: string;
  planSource: PlanSourceKind;
  /** The report's one sentence, and for AMBER its plain-English "What changed". */
  summary: string;
  whatChanged: string[];
  /** The RED hypothesis, or why there is none; null when none was asked for. */
  explanation: Explanation | null;
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

const isLocal = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

async function preflight(url: URL): Promise<void> {
  try {
    // A real site can take seconds to answer a request that is not from a browser; the local shops answer at once.
    await fetch(url, { signal: AbortSignal.timeout(isLocal(url) ? 3000 : 20_000) });
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
    const why = cause ? cause.message || (cause as NodeJS.ErrnoException).code || cause.name : String(error);
    const hint = isLocal(url) ? ' Start the shops (pnpm shop) and run pnpm engine doctor.' : ' Check the address and your internet connection.';
    throw new SetupError(`${url.origin} is not reachable (${why}).${hint}`);
  }
}

/** Which events earn a screenshot, and what the report says under it. */
function shotFor(e: Record<string, unknown>): Omit<RunShot, 'file'> | null {
  const stepKey = typeof e.stepKey === 'string' ? e.stepKey : null;
  switch (e.type) {
    case 'resolved':
      return Number(e.rung) > 1 ? { kind: 'healed', stepKey, caption: `Found ${String(e.target)} instead of ${String(e.planned)} (rung ${String(e.rung)})` } : null;
    case 'replanned':
      return { kind: 'replanned', stepKey: typeof e.milestoneKey === 'string' ? e.milestoneKey : null, caption: `Re-planned ${String(e.milestoneKey)}: ${String(e.why)}` };
    case 'unresolved':
      return { kind: 'unresolved', stepKey, caption: `Could not find ${String(e.target)}` };
    case 'stopped':
      return { kind: 'stopped', stepKey, caption: `Stopped: ${String(e.message)}` };
    default:
      return null;
  }
}

function asSetupError<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw new SetupError(error instanceof Error ? error.message : String(error));
  }
}

export async function runIntent(options: RunOptions): Promise<RunResult> {
  return (await runCore(options, null)) as RunResult;
}

export interface ExploreOptions extends Pick<RunOptions, 'target' | 'headed' | 'slowMo' | 'quiet' | 'envOverride' | 'onEvent'> {
  intent: Intent;
}

/** Explore mode: plan, act and heal on any site with no verifier, so the result is UNVERIFIED (see explore.ts). */
export async function exploreGoal(options: ExploreOptions): Promise<ExploreResult> {
  return (await runCore({ ...options, intentFile: '' }, options.intent)) as ExploreResult;
}

async function runCore(options: RunOptions, explored: Intent | null): Promise<RunResult | ExploreResult> {
  const root = findRepoRoot();
  const config = loadConfig(root);
  const explore = explored !== null;
  const intent = explored ?? asSetupError(() => loadIntent(resolve(options.intentFile)));
  const goalHash = sha256(intent.goal);

  // The engine boundary: the executor and planner get goal + input keys (values by key only for filling); only the verifier gets the oracle.
  const healer = redactForHealer(intent);
  const inputs = flattenInputs(intent.inputs);

  const prompts = asSetupError(() => ({ plan: loadPrompt(root, 'planner'), expand: loadPrompt(root, 'expand') }));
  const resolvePrompt = asSetupError(() => loadPrompt(root, 'resolve'));
  const replanPrompt = asSetupError(() => loadPrompt(root, 'replan'));
  const explainPrompt = asSetupError(() => loadPrompt(root, 'explain'));
  const promptHash = planPromptHash(prompts);
  let plan: Plan | null;
  let planSource: PlanSourceKind;
  let planLabel: string;
  let cacheNote: string | null = null;
  if (options.planFile) {
    const planFile = resolve(options.planFile);
    plan = asSetupError(() => loadPlan(planFile));
    planSource = 'hand-written';
    planLabel = relative(root, planFile).replace(/\\/g, '/');
  } else {
    const cached = loadCachedPlan(root, intent.id, goalHash, promptHash);
    plan = cached.plan;
    planSource = cached.plan ? 'cache' : 'planner';
    planLabel = relative(root, planCacheFile(root, intent.id)).replace(/\\/g, '/');
    if (!cached.plan) cacheNote = cached.reason;
  }
  if (plan) {
    const problems = planInputProblems(plan, healer.inputKeys);
    if (problems.length > 0) throw new SetupError(`the plan does not fit the intent:\n  ${problems.join('\n  ')}`);
  }

  const env = { ...process.env, ...options.envOverride };
  const llmCacheDir = join(root, 'runs', 'llm-cache');
  const settings = asSetupError(() => resolveLlmSettings(config, env, readManifest(llmCacheDir)));
  const needsModel = planSource !== 'hand-written' && (!plan || plan.milestones.some((milestone) => !isExpanded(milestone)));
  const plannerTier = settings.tiers[config.models.planner];
  if (needsModel && !plannerTier.ok) {
    throw new SetupError(`the planner needs a model (${planSource === 'planner' ? cacheNote : 'some milestones have no steps yet'}): ${plannerTier.problem}`);
  }

  const targetUrl = parseTarget(options.target);
  const origin = targetUrl.origin;
  await preflight(targetUrl);

  const budgets: Budgets = { ...config.budgets, ...intent.budgets };
  const runDir = createRunDir(join(root, 'runs'), intent.id, targetUrl.toString());
  const runId = basename(runDir);
  const writeJson = (file: string, value: unknown) => writeFileSync(join(runDir, file), `${JSON.stringify(value, null, 2)}\n`);
  writeJson('config-used.json', { ...config, budgets, intentBudgetOverrides: intent.budgets ?? {} });

  const events = new EventLog(join(runDir, 'events.jsonl'));
  if (!options.quiet) events.onEvent(printEvent);
  if (options.onEvent) events.onEvent(options.onEvent);
  const timings = new Timings();
  const startedAt = new Date().toISOString();
  const runStartedMs = Date.now();
  events.emit('run_started', { runId, intentId: intent.id, target: targetUrl.toString(), plan: planLabel, planSource, budgets });
  events.emit('llm_settings', {
    mode: settings.mode,
    strong: describeTier(settings.tiers.strong),
    fast: describeTier(settings.tiers.fast),
    pinnedToManifest: settings.pinnedToManifest,
    used: needsModel,
  });
  if (cacheNote && planSource === 'planner') events.emit('plan_cache_miss', { reason: cacheNote });
  if (plan && planSource === 'hand-written' && (plan.intentId !== intent.id || plan.goalHash !== goalHash)) {
    events.emit('plan_mismatch', { message: `plan ${planLabel} was written for ${plan.intentId}, not ${intent.id}; its input keys fit, so it runs` });
  }

  const llm = new LlmAdapter({
    settings,
    config,
    cacheDir: llmCacheDir,
    maxCalls: budgets.maxLlmCallsPerRun,
    deadline: () => runStartedMs + budgets.runMs,
    events,
    timings,
    rejectDir: join(runDir, 'llm-rejected'),
  });
  // Hand-written plans get the planner too, but only ever for a re-planned milestone that continues on a later
  // screen: they arrive fully expanded and are never written to the plan cache.
  // Explore mode meets real pages far bigger than the demo shop: a smaller tree that is trimmed rather than refused,
  // so one request stays inside a free-tier token-per-minute limit.
  const tree = explore ? { maxNodes: 220, maxTextChars: 60, overflow: 'trim' as const } : config.tree;
  const planner = createPlanner({ llm, prompts, healer, inputValues: inputs, goalHash, tree });
  const replanner = createReplanner({ llm, prompt: replanPrompt, healer, inputValues: inputs, tree });
  const locators = LocatorCache.load(root, intent.id, planSource === 'hand-written');
  // A second, untouched copy: the report shows each entry the run wrote against what it held before.
  const locatorsBefore = LocatorCache.load(root, intent.id, planSource === 'hand-written');
  const locatorsLabel = relative(root, locators.file).replace(/\\/g, '/');
  const explainer = createExplainer({ llm, prompt: explainPrompt, valueOwners: valueOwnersOf(inputs) });
  if (locators.problem) events.emit('locator_cache_ignored', { file: locatorsLabel, reason: locators.problem });
  const picker = createRung3Picker({
    llm,
    prompt: resolvePrompt,
    healer,
    tree,
    valueOwners: valueOwnersOf(inputs),
    candidatesPerStep: config.ladder.candidatesPerStep,
    fullTreeBelowScore: config.ladder.fullTreeBelowScore,
  });

  // Explore mode has no source of truth to read, so no verifier at all: the result can only be UNVERIFIED.
  const verifier = explore ? null : createVerifier(intent, { origin, evidenceDir: join(runDir, 'evidence'), defaultPollMs: config.verifier.pollMs });
  if (verifier) {
    let baseline;
    try {
      baseline = await verifier.baseline();
    } catch (error) {
      throw new SetupError(`cannot read the store before the run: ${error instanceof Error ? error.message : String(error)}`);
    }
    events.emit('verifier_baseline', { count: baseline.count, maxId: baseline.maxId });
  }

  const browser = await chromium.launch({ headless: !options.headed, slowMo: options.slowMo ?? 0 });
  try {
    const viewport = { width: 1280, height: 800 };
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport,
      ...(options.video ? { recordVideo: { dir: join(runDir, 'video-raw'), size: viewport } } : {}),
    });
    // Blast radius: no HTTP outside the app. Explore mode lets a real site load its images and scripts from its other
    // domains; navigation steps still stay on the site's own origin (checkAllowed).
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (explore || sameOrigin(url, origin) || url.startsWith('data:')) return route.continue();
      events.emit('blocked_request', { url });
      return route.abort('blockedbyclient');
    });
    // Real sites open some links in a new tab, which would leave the run on the old page: explore keeps them in one.
    if (explore) {
      await context.addInitScript(
        "document.addEventListener('click', (event) => { const link = event.target instanceof Element ? event.target.closest('a[target]') : null; if (link) link.target = '_self'; }, true);",
      );
    }
    const page = await context.newPage();
    page.on('dialog', (dialog) => {
      events.emit('dialog_dismissed', { dialogType: dialog.type() });
      void dialog.dismiss().catch(() => undefined);
    });

    // The screen at every change or failure: a control found another way, a section re-planned, a step not found, a stop.
    const shots: RunShot[] = [];
    const shooting: Promise<void>[] = [];
    events.onEvent((event) => {
      const shot = shotFor(event as EngineEvent & Record<string, unknown>);
      if (!shot) return;
      const file = `shots/${String(shooting.length + 1).padStart(2, '0')}-${(shot.stepKey ?? shot.kind).replace(/[^a-z0-9.-]+/gi, '-')}.png`;
      shooting.push(
        page
          .screenshot({ path: join(runDir, file), timeout: 4000 })
          .then(() => void shots.push({ file, ...shot }))
          .catch(() => undefined),
      );
    });
    const takenShots = async () => {
      await Promise.all(shooting);
      return shots.sort((a, b) => a.file.localeCompare(b.file));
    };

    // A hang still reports what the run did before it: actions, rungs and heals (heals are in the locator cache).
    let snapshot: ExecutionSnapshot | null = null;
    let watchdog: NodeJS.Timeout | undefined;
    const hung = new Promise<ExecutionResult>((settleRace) => {
      const reason = { code: 'run_timeout', message: `the run did not finish within ${budgets.runMs + WATCHDOG_GRACE_MS} ms` };
      watchdog = setTimeout(() => {
        settleRace(
          snapshot?.(reason) ?? {
            outcome: 'environment',
            reason,
            terminalAttempted: false,
            healerBelievedDone: { believed: false, atStep: null, stepKey: null },
            actions: 0,
            lastStepKey: null,
            rungHistogram: emptyRungHistogram(),
            environmentErrors: [],
            heals: [],
            reusedHealsFrom: [],
            replans: [],
            plan,
            expanded: [],
            replanned: [],
            completed: [],
            started: [],
            skipped: [],
          },
        );
      }, budgets.runMs + WATCHDOG_GRACE_MS);
    });
    const execution = await Promise.race([
      execute({
        page,
        origin,
        startUrl: targetUrl.toString(),
        plan,
        planner,
        healer,
        inputs,
        budgets,
        settle: config.settle,
        ladder: config.ladder,
        locators,
        picker,
        replanner,
        runId,
        events,
        timings,
        afterAction: options.afterAction,
        onSnapshot: (read) => {
          snapshot = read;
        },
      }),
      hung,
    ]).finally(() => clearTimeout(watchdog));

    const { plan: executedPlan, expanded, replanned, completed, reusedHealsFrom, started, skipped, ...outcome } = execution;
    writeJson('plan-used.json', executedPlan);
    // Planned and re-planned steps go to the plan cache, so the next run needs no model; hand plans never do.
    let planCached = false;
    if (planSource !== 'hand-written' && executedPlan && (planSource === 'planner' || expanded.length > 0 || replanned.length > 0)) {
      const file = savePlanCache(root, cacheablePlan(executedPlan, expanded, completed, { keys: replanned, original: plan }));
      planCached = true;
      events.emit('plan_cached', { file: relative(root, file).replace(/\\/g, '/'), expanded, replanned, completed });
    }
    // The fix the system emits: heals are written to the locator cache for review; the next run hits rung 1.
    const locatorsUpdated = locators.updatedKeys();
    if (locators.save()) events.emit('locators_saved', { file: locatorsLabel, updated: locatorsUpdated });

    const usage = llm.usage();
    const record: RunRecord = {
      runId,
      intentId: intent.id,
      target: targetUrl.toString(),
      startedAt,
      endedAt: new Date().toISOString(),
      ...outcome,
      llmCalls: usage.llmCalls,
      tokens: usage.tokens,
      timings: timings.summary(),
    };

    if (!verifier) {
      const screenshot = await page
        .screenshot({ path: join(runDir, 'final.png') })
        .then(() => 'final.png')
        .catch(() => null);
      const finalHeading = await page
        .locator('h1')
        .first()
        .innerText({ timeout: 1000 })
        .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, 120) || null)
        .catch(() => null);
      const result: ExploreResult = {
        runDir,
        outcome: record.outcome,
        reason: record.reason,
        healerBelievedDone: record.healerBelievedDone,
        actions: record.actions,
        milestones: started,
        finalUrl: page.url(),
        finalTitle: await page.title().catch(() => ''),
        finalHeading,
        llmCalls: record.llmCalls.total,
        screenshot,
        shots: await takenShots(),
      };
      writeJson('run-record.json', record);
      const markdown = renderExploreReport(intent.goal, targetUrl.toString(), executedPlan, result);
      writeFileSync(join(runDir, 'report.md'), markdown);
      writeFileSync(join(runDir, 'report.html'), markdownToHtml(markdown, `UNVERIFIED · ${intent.id}`));
      if (!options.quiet) printExploreBlock(result);
      return result;
    }

    const runShots = await takenShots();
    const oracle = await verifier.verify(page, record);
    events.emit('verifier_result', { state: oracle.state, binding: oracle.binding, alerts: oracle.alerts });
    const verdict = decideVerdict(oracle, record);
    events.emit('verdict', { color: verdict.color, kind: verdict.kind, reasons: verdict.reasons });

    // Reporter-explain: after a real bug only, once the verdict is final; it narrates and cannot change it.
    let explanation: Explanation | null = null;
    if (verdict.kind === 'real_bug') {
      explanation = await explainer.explain(verdict);
      if ('hypothesis' in explanation) events.emit('explained', { hypothesis: explanation.hypothesis });
      else events.emit('explain_skipped', { reason: explanation.skipped });
    }

    const locatorChanges: LocatorChange[] = locatorsUpdated.flatMap((stepKey) => {
      const after = locators.get(stepKey);
      return after ? [{ stepKey, before: locatorsBefore.get(stepKey)?.locator ?? null, after: after.locator, rung: after.rung }] : [];
    });
    const reportContext: ReportContext = {
      config: { ...config, budgets },
      record,
      intentFile: relative(root, resolve(options.intentFile)).replace(/\\/g, '/'),
      planFile: planLabel,
      planSource,
      runDir,
      llmMode: settings.mode,
      locatorsFile: locatorsLabel,
      locatorsUpdated,
      locatorChanges,
      reusedHealsFrom,
      planBefore: plan,
      planAfter: executedPlan,
      planCached,
      started,
      skipped,
      expanded,
      replanned,
      explanation,
    };
    writeJson('run-record.json', record);
    writeJson('verdict.json', verdict);
    const markdown = renderReport(verdict, reportContext);
    writeFileSync(join(runDir, 'report.md'), markdown);
    writeFileSync(join(runDir, 'report.html'), markdownToHtml(markdown, `${banner(verdict)} · ${intent.id}`));
    if (!options.quiet) printFinalBlock(verdict, reportContext);
    if (options.video) {
      // The recording is finished only once its context closes.
      const video = page.video();
      await context.close();
      if (video) {
        await video.saveAs(join(runDir, 'video.webm'));
        await video.delete();
      }
      rmSync(join(runDir, 'video-raw'), { recursive: true, force: true });
    }
    return {
      verdict,
      shots: runShots,
      runDir,
      planSource,
      summary: summary(verdict, reportContext),
      whatChanged: verdict.kind === 'ui_drift' ? whatChanged(verdict, reportContext) : [],
      explanation,
    };
  } finally {
    await browser.close();
  }
}

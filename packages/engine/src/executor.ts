import { performance } from 'node:perf_hooks';
import {
  emptyRungHistogram,
  isExpanded,
  sameTarget,
  type Budgets,
  type HealEvent,
  type HealerDone,
  type HealerIntent,
  type Milestone,
  type Plan,
  type Reason,
  type ReplanEvent,
  type RunOutcome,
  type RungHistogram,
  type Step,
} from '@hackwave/contracts';
import { errors, type Locator, type Page, type Request } from 'playwright';
import { checkProgress, perform } from './act';
import { checkAllowed, sameOrigin } from './allowlist';
import type { PageState } from './aria';
import { completionHolds } from './completion';
import type { EngineConfig } from './config';
import type { EventLog } from './events';
import { accessibleName } from './fingerprint';
import { concreteFromCached, createLadder, describeLandmark, expectationFor, type Expectation, type RungOutcome, type ScoredCandidate } from './ladder';
import { sameLocator, type LocatorCache, type LocatorCacheEntry } from './locator-cache';
import { OutcomeError } from './outcome';
import type { PlanSource } from './planner';
import type { Replanner } from './replanner';
import type { Rung3Picker, Rung3Request } from './resolver';
import { concreteTarget, describeTarget, type ConcreteTarget } from './resolve';
import { settle, type SettleConfig } from './settle';
import { describeStep } from './step-rules';
import type { Timings } from './timing';
import { redactValues, valueOwnersOf } from './tree';

export interface ExecuteInput {
  page: Page;
  /** The app origin; navigation and requests outside it are refused. */
  origin: string;
  startUrl: string;
  /** A hand-written or cached plan, or null to have the planner write one from the landing screen. */
  plan: Plan | null;
  /**
   * Writes the plan when there is none and expands milestones that have no steps yet, or that a re-plan left
   * to continue on a later screen. Absent means the plan must be complete as given.
   */
  planner?: PlanSource;
  /** Goal and input keys only: everything the healer is allowed to know. */
  healer: HealerIntent;
  /** Input values by key, used to fill fields and to name scopes. Never logged, never sent to a model. */
  inputs: Readonly<Record<string, string>>;
  budgets: Budgets;
  settle: SettleConfig;
  ladder: EngineConfig['ladder'];
  /** runs/locators/<intentId>.json: rung 1 reads it, heals write it. */
  locators: LocatorCache;
  /** Rung 3. Absent means the ladder stops at rung 2. */
  picker?: Rung3Picker;
  /** Rung 5: milestone re-plan. Absent means a step no rung resolves stops the run. */
  replanner?: Replanner;
  runId: string;
  events: EventLog;
  timings: Timings;
  /** Eval hook, awaited after every action (used to kill the server mid-run). */
  afterAction?: (stepKey: string) => Promise<void>;
  /** Receives a reader of the run so far, so a watchdog verdict still reports the actions and heals that happened. */
  onSnapshot?: (snapshot: ExecutionSnapshot) => void;
}

/** The run so far, ended with the given reason. */
export type ExecutionSnapshot = (reason: Reason) => ExecutionResult;

export interface ExecutionResult {
  outcome: RunOutcome;
  reason: Reason | null;
  terminalAttempted: boolean;
  healerBelievedDone: HealerDone;
  actions: number;
  lastStepKey: string | null;
  rungHistogram: RungHistogram;
  environmentErrors: string[];
  heals: HealEvent[];
  /** Runs whose earlier heals this run reused on rung 1. */
  reusedHealsFrom: string[];
  /** Rung-5 milestone re-plans, in order. */
  replans: ReplanEvent[];
  /** The plan as executed, expansions and re-plans included. */
  plan: Plan | null;
  /** Milestones whose steps were written during this run. */
  expanded: string[];
  /** Milestones whose remaining steps a re-plan rewrote during this run. */
  replanned: string[];
  /** Milestones whose steps all ran through, or whose completion already held when they came up. */
  completed: string[];
}

/** A milestone marked "more" is expanded again on each new screen, at most this many times. */
const MAX_REEXPANSIONS_PER_MILESTONE = 3;

/**
 * Thrown by a step that no rung resolved, or whose action changed nothing: the milestone goes to rung 5.
 * code and message are the run's reason if it cannot be re-planned.
 */
class ReplanNeeded extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly failures: string[],
  ) {
    super(message);
  }
}

/** The same targets in the same order: a re-plan that changes nothing. */
function sameSteps(a: readonly Step[], b: readonly Step[]): boolean {
  return a.length === b.length && a.every((step, index) => {
    const other = b[index];
    return other !== undefined && step.action === other.action && sameTarget(step, other);
  });
}

/** Connection-level failures only; aborted requests (navigation) and our own blocks are not environment errors. */
const CONNECTION_ERROR =
  /net::ERR_(CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_FAILED|EMPTY_RESPONSE|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TIMED_OUT|ADDRESS_UNREACHABLE|NETWORK_CHANGED)/;

function classify(error: unknown): OutcomeError {
  if (error instanceof OutcomeError) return error;
  const message = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim() || 'unknown error';
  if (error instanceof errors.TimeoutError) return new OutcomeError('environment', 'step_timeout', message);
  if (/has been closed|crash/i.test(message)) return new OutcomeError('environment', 'browser_crash', message);
  if (/net::ERR_/.test(message)) return new OutcomeError('environment', 'navigation_error', message);
  return new OutcomeError('environment', 'unexpected_error', message);
}

/** How a step's target was found: the winning rung, what it expected, and why the cheaper rungs failed. */
interface Resolution {
  outcome: RungOutcome;
  expectation: Expectation;
  failures: string[];
}

/**
 * Runs a plan. Hard gates around every action: budgets, allowlist, settle gate, the resolution ladder
 * (cached locator, attribute similarity, fast model per screen) with objective validation, progress check,
 * loop detection. The terminal action runs at most once and hands straight over to the verifier.
 * Every resolution, heal, action and budget tick is a line in events.jsonl.
 */
export async function execute(input: ExecuteInput): Promise<ExecutionResult> {
  const { page, origin, budgets, events, timings, inputs, planner, locators } = input;
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);
  const inputKeys = new Set(input.healer.inputKeys);
  const valueOwners = valueOwnersOf(inputs);
  const ladder = createLadder({ page, inputs, valueOwners, ladder: input.ladder });
  const rungHistogram = emptyRungHistogram();
  const environmentErrors: string[] = [];
  const heals: HealEvent[] = [];
  const reusedHealsFrom = new Set<string>();
  const expanded: string[] = [];
  const completed: string[] = [];
  /** Milestones finished (ran through or already satisfied): the next one needs all its dependencies here. */
  const done = new Set<string>();
  const replans: ReplanEvent[] = [];
  const replanned: string[] = [];
  const doneSteps: Step[] = [];
  /** Milestones whose expansion said "more": they continue on a later screen. */
  const needsMore = new Set<string>();
  const reexpansions = new Map<string, number>();
  /** Rung-3 attempts per step and screen, against budgets.maxRung3AttemptsPerStepPerScreen. */
  const rung3Attempts = new Map<string, number>();
  /** Rung-3 answers for later steps of a batch, kept for when the run reaches them on the same screen. */
  const preResolved = new Map<string, { screen: string; outcome: RungOutcome }>();
  /** Rung-5 re-plans per milestone, against budgets.maxReplansPerMilestone. */
  const replanCount = new Map<string, number>();
  /** Keys of steps written on this run's live screens, by expansion or re-plan. */
  const writtenThisRun = new Set<string>();
  let plan: Plan | null = input.plan ? structuredClone(input.plan) : null;
  let actions = 0;
  let lastStepKey: string | null = null;
  let terminalAttempted = false;
  let healerBelievedDone: HealerDone = { believed: false, atStep: null, stepKey: null };
  let state: PageState | null = null;
  let unchangedActions = 0;

  const onRequestFailed = (request: Request) => {
    const failure = request.failure()?.errorText ?? '';
    if (!sameOrigin(request.url(), origin) || !CONNECTION_ERROR.test(failure)) return;
    const message = `${request.method()} ${request.url()} failed: ${failure}`;
    environmentErrors.push(message);
    events.emit('environment_error', { message });
  };
  page.on('requestfailed', onRequestFailed);

  const finish = (outcome: RunOutcome, reason: Reason | null): ExecutionResult => ({
    outcome,
    reason,
    terminalAttempted,
    healerBelievedDone,
    actions,
    lastStepKey,
    rungHistogram,
    environmentErrors,
    heals,
    reusedHealsFrom: [...reusedHealsFrom],
    replans,
    plan,
    expanded,
    replanned,
    completed,
  });
  // A copy: the executor may still be unwinding when the watchdog reads it.
  input.onSnapshot?.((reason) => structuredClone(finish('environment', reason)));

  /** Time left for one step: the step budget, capped by what remains of the run budget. */
  const stepBudget = (): number => {
    const left = budgets.runMs - elapsedMs();
    if (left <= 0) throw new OutcomeError('environment', 'run_timeout', `run budget of ${budgets.runMs} ms exhausted`);
    return Math.min(budgets.stepMs, left);
  };

  const settleNow = async (label: string): Promise<PageState> => {
    const result = await settle(page, input.settle);
    if (!result.settled) events.emit('settle_timeout', { label, waitedMs: result.waitedMs });
    return result.state;
  };

  /** A screen is a path plus the dialogs open on it: one rung-3 attempt per step per screen. */
  async function screenKey(): Promise<string> {
    const dialogs: string[] = [];
    for (const dialog of await page.getByRole('dialog').filter({ visible: true }).all()) dialogs.push(await accessibleName(dialog));
    return `${new URL(page.url()).pathname}|${dialogs.sort().join(',')}`;
  }

  /**
   * What a step is for, for rung 3: its hint. Without one, the step's own planned element and the step before it,
   * with the milestone only as context: a milestone description alone ("add it to the cart and open the cart")
   * can point the model at the wrong half of the milestone.
   */
  const purposeOf = (step: Step, milestone: Milestone): string => {
    if ('target' in step && step.target?.hint) return step.target.hint;
    const index = milestone.steps.indexOf(step);
    const previous = index > 0 ? milestone.steps[index - 1] : doneSteps[doneSteps.length - 1];
    const after = previous ? `, right after ${previous.key} (${describeStep(previous)})` : '';
    return `${describeStep(step)}${after}; part of milestone ${milestone.key}: ${milestone.description}`;
  };

  /** Targets acted on since the page last navigated: rungs 2 and 3 never heal onto them. */
  const acted = { url: '', targets: [] as ConcreteTarget[] };
  const actedHere = (): ConcreteTarget[] => {
    if (page.url() !== acted.url) {
      acted.url = page.url();
      acted.targets = [];
    }
    return acted.targets;
  };

  /**
   * The cache entry rung 1 starts from. A step written on this run's live screen (expansion or re-plan) already
   * names its element; an entry cached for an older step with the same key and another target does not apply.
   */
  const cacheEntryFor = (step: Step): LocatorCacheEntry | undefined => {
    const entry = locators.get(step.key);
    if (!entry || !writtenThisRun.has(step.key) || !('target' in step) || !step.target) return entry;
    return sameLocator(entry.locator, step.target) ? entry : undefined;
  };

  const failed = (reason: string): RungOutcome => ({
    ok: false,
    rung: 3,
    reason,
    locator: null,
    target: null,
    cachedLocator: null,
    fingerprint: null,
    validation: { unique: false, visible: false, enabled: false, roleMatch: false, inLandmark: false },
    score: null,
    ms: 0,
  });

  /**
   * Rung 3: one fast-model call for this step and every later step of the milestone that rungs 1 and 2 cannot
   * resolve on this screen either. Answers for the later steps are kept until the run reaches them.
   */
  async function rung3(milestone: Milestone, index: number, step: Step, expectation: Expectation, candidates: ScoredCandidate[]): Promise<RungOutcome> {
    const screen = await screenKey();
    const kept = preResolved.get(step.key);
    if (kept && kept.screen === screen) {
      preResolved.delete(step.key);
      if (!kept.outcome.ok || !kept.outcome.target) return kept.outcome;
      const again = await ladder.rung1({ ...expectation, cached: null, target: kept.outcome.target }, 0);
      return again.ok ? kept.outcome : failed(`the rung-3 pick ${describeTarget(kept.outcome.target)} no longer validates`);
    }
    if (!input.picker) return failed('no model is available for rung 3');
    const attempts = (key: string) => rung3Attempts.get(`${key}|${screen}`) ?? 0;
    if (attempts(step.key) >= budgets.maxRung3AttemptsPerStepPerScreen) return failed('rung 3 was already tried for this step on this screen');
    if (candidates.length === 0) return failed('there are no candidates of this role on this screen');

    const batch: Rung3Request[] = [{ expectation, purpose: purposeOf(step, milestone), candidates }];
    for (const later of milestone.steps.slice(index + 1)) {
      const laterExpectation = expectationFor(later, cacheEntryFor(later), inputs);
      if (!laterExpectation || preResolved.has(later.key) || attempts(later.key) >= budgets.maxRung3AttemptsPerStepPerScreen) continue;
      if ((await ladder.rung1(laterExpectation, 0)).ok) continue;
      const laterRung2 = await ladder.rung2(laterExpectation, actedHere());
      if (laterRung2.ok || laterRung2.candidates.length === 0) continue;
      batch.push({ expectation: laterExpectation, purpose: purposeOf(later, milestone), candidates: laterRung2.candidates });
    }
    const started = performance.now();
    const picks = await input.picker.pick(page, batch);
    let own: RungOutcome = failed('rung 3 did not answer');
    for (const request of batch) {
      const key = request.expectation.stepKey;
      rung3Attempts.set(`${key}|${screen}`, attempts(key) + 1);
      const chosen = picks.get(key) ?? null;
      const outcome = chosen
        ? await ladder.adopt(chosen, request.expectation, 3, started, 'picked by the fast model')
        : failed('the fast model found no candidate that does this step');
      if (key === step.key) own = outcome;
      else preResolved.set(key, { screen, outcome });
    }
    return own;
  }

  /**
   * Resolution ladder: rung 1, then rung 2, then rung 3. A step none of them resolves goes to rung 5 (the
   * milestone re-plan) in the milestone loop. Heals never land on an element already acted on, on this screen.
   */
  async function resolveTarget(milestone: Milestone, index: number, step: Step, escalateFrom: ConcreteTarget | null = null): Promise<Resolution> {
    const expectation = expectationFor(step, cacheEntryFor(step), inputs);
    if (!expectation) throw new OutcomeError('unresolvable', 'no_target', `${step.key} has no target to resolve`);
    const failures: string[] = [];
    if (escalateFrom) {
      // A rung-2 heal acted but changed nothing: go one rung up, without the element that failed.
      failures.push(`rung 2: ${describeTarget(escalateFrom)} acted without effect`);
      const { candidates } = await ladder.candidatesFor(expectation, [...actedHere(), escalateFrom]);
      return { outcome: await rung3(milestone, index, step, expectation, candidates), expectation, failures };
    }
    const first = await ladder.rung1(expectation, Math.min(2000, stepBudget()));
    if (first.ok) return { outcome: first, expectation, failures };
    failures.push(`rung 1: ${first.reason}`);
    const second = await ladder.rung2(expectation, actedHere());
    if (second.ok) return { outcome: second, expectation, failures };
    failures.push(`rung 2: ${second.reason}`);
    if (expectation.scope?.required && second.candidates.length === 0) return { outcome: failed('nothing to ask: the required scope is missing'), expectation, failures };
    const third = await rung3(milestone, index, step, expectation, second.candidates);
    if (!third.ok) failures.push(`rung 3: ${third.reason}`);
    return { outcome: third, expectation, failures };
  }

  /** After the action worked: a heal becomes a HealEvent and a cache entry; a first success is cached too. */
  function commit(milestone: Milestone, step: Step, resolution: Resolution): void {
    const { outcome, expectation } = resolution;
    if (!outcome.target || !outcome.cachedLocator || !outcome.fingerprint) return;
    const entry = { locator: outcome.cachedLocator, fingerprint: outcome.fingerprint, updatedByRun: input.runId, updatedAt: new Date().toISOString() };
    if (outcome.rung === 1) {
      if (expectation.cached) {
        if (expectation.cached.rung >= 2) reusedHealsFrom.add(expectation.cached.updatedByRun);
        return;
      }
      locators.set(step.key, { ...entry, rung: 1 });
      events.emit('locator_cached', { stepKey: step.key, target: describeTarget(outcome.target) });
      return;
    }
    const before = expectation.cached ? (concreteFromCached(expectation.cached.locator, inputs) ?? expectation.target) : expectation.target;
    const heal: HealEvent = {
      runId: input.runId,
      milestoneKey: milestone.key,
      stepKey: step.key,
      from: before,
      to: outcome.target,
      rung: outcome.rung,
      reason: [...resolution.failures, outcome.reason].join('; '),
      validation: outcome.validation,
      ms: outcome.ms,
    };
    heals.push(heal);
    locators.set(step.key, { ...entry, rung: outcome.rung });
    const fromText = describeTarget(before);
    const toText = describeTarget(outcome.target);
    // Same locator, new place: the heal is the landmark move, so say that rather than "X became X".
    const moved =
      fromText === toText && expectation.cached ? `moved from ${describeLandmark(expectation.cached.fingerprint)} to ${describeLandmark(outcome.fingerprint)}` : null;
    events.emit('healed', { ...heal, fromText, toText, moved });
  }

  /** The terminal milestone's committing step, once it is known. */
  function committingStep(): Step | null {
    const terminal = plan?.milestones.find((milestone) => milestone.terminal);
    if (!terminal || !isExpanded(terminal) || needsMore.has(terminal.key)) return null;
    return terminal.steps[terminal.steps.length - 1] ?? null;
  }

  /** One step: resolve, act, settle, check progress. Returns true once the terminal action has run. */
  async function runStep(milestone: Milestone, index: number, step: Step): Promise<boolean> {
    // The terminal action is the last step of the terminal milestone once it is fully expanded.
    const isTerminalAction = milestone.terminal && index === milestone.steps.length - 1 && !needsMore.has(milestone.key);
    if (actions >= budgets.maxActions) {
      throw new OutcomeError('unresolvable', 'action_budget_exhausted', `action budget of ${budgets.maxActions} exhausted`);
    }
    const allowed = checkAllowed(step, origin, inputKeys);
    if (!allowed.ok) {
      events.emit('refused', { milestoneKey: milestone.key, stepKey: step.key, message: allowed.message });
      throw new OutcomeError('refused', allowed.code, allowed.message);
    }
    // Terminal rule: the committing click runs only as the terminal milestone's last step, never from elsewhere.
    const commitStep = committingStep();
    if (!milestone.terminal && commitStep && sameTarget(step, commitStep)) {
      const message = `${step.key} would perform the committing action (${commitStep.key}) outside the terminal milestone`;
      events.emit('refused', { milestoneKey: milestone.key, stepKey: step.key, message });
      throw new OutcomeError('refused', 'commit_outside_terminal', message);
    }

    let resolution: Resolution | null = null;
    const resolve = async (escalateFrom: ConcreteTarget | null = null): Promise<Resolution> => {
      const found = await resolveTarget(milestone, index, step, escalateFrom);
      const target = describeTarget(found.expectation.target);
      if (!found.outcome.ok || !found.outcome.target) {
        events.emit('unresolved', { milestoneKey: milestone.key, stepKey: step.key, target, failures: found.failures });
        throw new ReplanNeeded('unresolved', `${step.key}: no rung could resolve ${target} (${found.failures.join('; ')})`, found.failures);
      }
      rungHistogram[String(found.outcome.rung) as '1' | '2' | '3']++;
      events.emit('resolved', {
        milestoneKey: milestone.key,
        stepKey: step.key,
        rung: found.outcome.rung,
        action: step.action,
        target: describeTarget(found.outcome.target),
        planned: target,
        validation: found.outcome.validation,
        score: found.outcome.score,
        ms: found.outcome.ms,
      });
      return found;
    };
    if ('target' in step && step.target) resolution = await resolve();

    const value = step.action === 'fill' || step.action === 'select' ? (inputs[step.inputRef] ?? null) : null;
    for (let attempt = 1; ; attempt++) {
      const locator: Locator | null = resolution?.outcome.locator ?? null;
      const target = resolution?.outcome.target ? describeTarget(resolution.outcome.target) : '';
      const before = state ?? (await settleNow(`before ${step.key}`));
      if (isTerminalAction) {
        terminalAttempted = true;
        events.emit('terminal_attempted', { milestoneKey: milestone.key, stepKey: step.key });
      }
      actions++;
      const actionStarted = performance.now();
      const actedOnThisScreen = actedHere();
      await perform(page, step, locator, value, origin, stepBudget());
      if (resolution?.outcome.target) actedOnThisScreen.push(resolution.outcome.target);
      if (attempt === 1) doneSteps.push(step);
      events.emit('action', {
        milestoneKey: milestone.key,
        stepKey: step.key,
        action: step.action,
        target,
        inputRef: step.action === 'fill' || step.action === 'select' ? step.inputRef : null,
        ms: Math.round(performance.now() - actionStarted),
        budget: { actions, maxActions: budgets.maxActions, elapsedMs: elapsedMs(), runMs: budgets.runMs },
      });
      if (input.afterAction) await input.afterAction(step.key);
      const after = await settleNow(step.key);
      state = after;

      if (isTerminalAction) {
        // Terminal rule: whatever happened, the run goes straight to the verifier. Never retried.
        if (resolution) commit(milestone, step, resolution);
        const completion = await completionHolds(page, milestone, inputs);
        healerBelievedDone = { believed: completion.holds, atStep: actions, stepKey: step.key };
        events.emit('healer_done', { believed: completion.holds, atStep: actions, stepKey: step.key, detail: completion.detail });
        return true;
      }

      if (!sameOrigin(page.url(), origin)) {
        throw new OutcomeError('refused', 'left_origin', `the page left ${origin} for ${page.url()}`);
      }

      const nextStep = milestone.steps[index + 1];
      const nextTarget: ConcreteTarget | null = nextStep && 'target' in nextStep && nextStep.target ? concreteTarget(nextStep.target, inputs) : null;
      const checked = await checkProgress({ page, step, locator, value, before, after, nextTarget });
      // The detail can quote the page (an alert); input values never reach the log.
      const progress = { ...checked, detail: redactValues(checked.detail, valueOwners) };
      events.emit('progress', { stepKey: step.key, ok: progress.ok, detail: progress.detail });
      if (progress.ok) {
        if (resolution) commit(milestone, step, resolution);
        unchangedActions = after.fullHash === before.fullHash ? unchangedActions + 1 : 0;
        if (unchangedActions >= 3) {
          throw new OutcomeError('unresolvable', 'loop_detected', 'the page did not change across three consecutive actions');
        }
        return false;
      }

      // A healed action without effect: undo the navigation if any, then escalate one rung (rung 2 only, once).
      if (resolution && resolution.outcome.rung >= 2) {
        events.emit('heal_rejected', { stepKey: step.key, rung: resolution.outcome.rung, target, detail: progress.detail });
        if (after.url !== before.url) {
          await page.goBack({ timeout: stepBudget() }).catch(() => undefined);
          state = await settleNow(`back after ${step.key}`);
        }
        if (resolution.outcome.rung === 2 && attempt === 1 && resolution.outcome.target) {
          resolution = await resolve(resolution.outcome.target);
          continue;
        }
      }
      // The page wants something the plan does not do (a new required field, a changed flow): rung 5.
      throw new ReplanNeeded('no_progress', `${step.key}: ${progress.detail}`, [`${step.action} ${target || step.key} had no effect: ${progress.detail}`]);
    }
  }

  /**
   * Steps for this milestone and the next ones on the same screen, written by the planner on the live page.
   * When continuing, the milestone already has steps and the new ones are appended.
   */
  async function expandFrom(current: Plan, milestone: Milestone, continuing: boolean): Promise<void> {
    if (!planner) throw new OutcomeError('unresolvable', 'plan_incomplete', `milestone ${milestone.key} has no steps and there is no planner`);
    const start = current.milestones.indexOf(milestone);
    const pending: Milestone[] = continuing ? [milestone] : [];
    for (const candidate of current.milestones.slice(continuing ? start + 1 : start)) {
      if (done.has(candidate.key) || isExpanded(candidate)) break;
      pending.push(candidate);
    }
    // Milestones still ahead that already have steps: the model is told they are not its to write.
    const later = current.milestones.filter((candidate) => !done.has(candidate.key) && !pending.includes(candidate));
    const written = await planner.expand(page, pending, doneSteps, committingStep(), later);
    for (const candidate of pending) {
      const expansion = written.get(candidate.key);
      if (!expansion) continue;
      for (const step of expansion.steps) writtenThisRun.add(step.key);
      candidate.steps = candidate === milestone && continuing ? [...candidate.steps, ...expansion.steps] : expansion.steps;
      candidate.expanded = true;
      if (expansion.more) needsMore.add(candidate.key);
      else needsMore.delete(candidate.key);
      if (!expanded.includes(candidate.key)) expanded.push(candidate.key);
    }
    events.emit('expanded', {
      milestones: pending.filter((candidate) => written.has(candidate.key)).map((candidate) => candidate.key),
      steps: [...written.values()].reduce((sum, expansion) => sum + expansion.steps.length, 0),
      more: [...written].filter(([, expansion]) => expansion.more).map(([key]) => key),
      path: new URL(page.url()).pathname,
    });
    state = await settleNow(`after expanding ${milestone.key}`);
  }

  /**
   * Skip-if-satisfied, for milestones with known steps and never the terminal one. "filled" holds only when its
   * fields already carry their inputs. A heading, url or visible condition can hold before the milestone ran
   * (a heading on the start page), so it skips only when the milestone's first step is not on this screen either.
   */
  async function alreadySatisfied(milestone: Milestone): Promise<string | null> {
    if (milestone.terminal || milestone.steps.length === 0) return null;
    if (milestone.completion.kind === 'filled' && !milestone.steps.some((step) => step.action === 'fill')) return null;
    const check = await completionHolds(page, milestone, inputs);
    if (!check.holds) return null;
    if (milestone.completion.kind !== 'filled' && (await opensHere(milestone))) return null;
    return check.detail;
  }

  /** Is the milestone's first step on this screen? Rungs 1 and 2 only: choosing an order never costs a model call. */
  async function opensHere(milestone: Milestone): Promise<boolean> {
    const step = milestone.steps[0];
    if (!step) return false;
    const expectation = expectationFor(step, cacheEntryFor(step), inputs);
    if (!expectation) return false;
    return (await ladder.rung1(expectation, 0)).ok || (await ladder.rung2(expectation, actedHere())).ok;
  }

  /**
   * Adaptive order: of the milestones whose dependencies are done, any whose completion already holds is
   * skipped; then the first whose opening step is on this screen goes next, so a reordered flow needs no
   * re-plan. When none is, plan order.
   */
  async function nextMilestone(current: Plan): Promise<Milestone | null> {
    for (;;) {
      const ready = current.milestones.filter((m) => !done.has(m.key) && m.dependsOn.every((dependency) => done.has(dependency)));
      const first = ready[0];
      if (!first) return null;
      let skipped = false;
      for (const milestone of ready) {
        const detail = await alreadySatisfied(milestone);
        if (detail === null) continue;
        events.emit('milestone_skipped', { milestoneKey: milestone.key, detail });
        completed.push(milestone.key);
        done.add(milestone.key);
        skipped = true;
      }
      // A skip can make other milestones ready.
      if (skipped) continue;
      if (ready.length === 1) return first;
      for (const candidate of ready) {
        if (!(await opensHere(candidate))) continue;
        if (candidate !== first) {
          events.emit('milestone_reordered', { milestoneKey: candidate.key, instead: first.key, detail: `${candidate.key} starts on this screen; ${first.key} does not` });
        }
        return candidate;
      }
      return first;
    }
  }

  /**
   * Rung 5: the strong model rewrites the rest of this milestone from the current screen, within the re-plan
   * budget. A re-plan that retries the failed step first, or repeats the old steps, is a loop and stops the run.
   */
  async function replanMilestone(current: Plan, milestone: Milestone, index: number, need: ReplanNeeded): Promise<void> {
    const failed = milestone.steps[index];
    const stop = (code: string, why: string) => new OutcomeError('unresolvable', code, `${need.message}; ${why}`);
    if (!failed) throw stop(need.code, 'there is no step to re-plan from');
    if (!input.replanner) throw stop(need.code, 'no re-planner (rung 5) is available');
    const maxAttempts = budgets.maxReplansPerMilestone;
    const attempt = (replanCount.get(milestone.key) ?? 0) + 1;
    if (attempt > maxAttempts) throw stop('replan_budget_exhausted', `milestone ${milestone.key} was already re-planned ${maxAttempts} time(s); refused to guess`);
    replanCount.set(milestone.key, attempt);
    // An action that changed nothing is not a step done, as far as the plan is concerned.
    if (doneSteps[doneSteps.length - 1] === failed) doneSteps.pop();
    events.emit('replan_started', { milestoneKey: milestone.key, stepKey: failed.key, attempt, maxAttempts });

    const oldSteps = milestone.steps.slice(index);
    const others = current.milestones.filter((other) => other !== milestone);
    const result = await input.replanner.replan(page, {
      milestone,
      index,
      failures: need.failures,
      done: doneSteps,
      attempt,
      maxAttempts,
      previous: replans.filter((event) => event.milestoneKey === milestone.key),
      later: others.filter((other) => !done.has(other.key)),
      commit: milestone.terminal ? null : committingStep(),
      taken: new Set([...doneSteps.map((step) => step.key), ...others.flatMap((other) => other.steps.map((step) => step.key))]),
    });
    if (result.steps.length === 0) throw stop('replan_impossible', `rung 5 found no way to carry milestone ${milestone.key} on: ${result.reason}`);
    const first = result.steps[0];
    if ((first && first.action === failed.action && sameTarget(first, failed)) || sameSteps(result.steps, oldSteps)) {
      throw stop('replan_loop', `the re-plan for ${milestone.key} starts with the step that just failed (${describeStep(failed)}); refused to loop`);
    }

    milestone.steps = [...milestone.steps.slice(0, index), ...result.steps];
    milestone.expanded = true;
    for (const step of result.steps) writtenThisRun.add(step.key);
    if (result.more) needsMore.add(milestone.key);
    else needsMore.delete(milestone.key);
    // Rung-3 answers kept for the replaced steps no longer apply.
    for (const step of oldSteps) preResolved.delete(step.key);
    rungHistogram['5']++;
    const event: ReplanEvent = { milestoneKey: milestone.key, reason: need.failures.join('; ') || need.message, oldSteps, newSteps: result.steps, attempt };
    replans.push(event);
    if (!replanned.includes(milestone.key)) replanned.push(milestone.key);
    events.emit('replanned', { ...event, maxAttempts, more: result.more, why: result.reason, added: result.steps.map(describeStep) });
  }

  try {
    await timings.measure('browser', 'start', async () => {
      await page.goto(input.startUrl, { timeout: stepBudget() });
      events.emit('navigated', { url: page.url() });
      state = await settleNow('start');
    });

    if (!plan) {
      if (!planner) throw new OutcomeError('unresolvable', 'no_plan', 'there is no plan and no planner');
      plan = await planner.plan(page);
      events.emit('planned', {
        milestones: plan.milestones.map((milestone) => ({ key: milestone.key, terminal: milestone.terminal, completion: milestone.completion })),
      });
    }
    const current = plan;

    for (;;) {
      const milestone = await nextMilestone(current);
      if (!milestone) break;
      events.emit('milestone_started', { milestoneKey: milestone.key, description: milestone.description, terminal: milestone.terminal });
      if (!isExpanded(milestone)) await expandFrom(current, milestone, false);

      for (let index = 0; ; index++) {
        if (index >= milestone.steps.length) {
          if (!needsMore.has(milestone.key)) break;
          // The milestone continues on this new screen: expand it again, within a bound.
          const count = (reexpansions.get(milestone.key) ?? 0) + 1;
          if (count > MAX_REEXPANSIONS_PER_MILESTONE) {
            throw new OutcomeError('unresolvable', 'expansion_loop', `milestone ${milestone.key} still needed more steps after ${MAX_REEXPANSIONS_PER_MILESTONE} screens`);
          }
          reexpansions.set(milestone.key, count);
          await expandFrom(current, milestone, true);
        }
        const step = milestone.steps[index];
        if (!step) break;
        lastStepKey = step.key;
        let reachedTerminal: boolean;
        try {
          reachedTerminal = await timings.measure('browser', step.key, () => runStep(milestone, index, step));
        } catch (error) {
          if (!(error instanceof ReplanNeeded)) throw error;
          await replanMilestone(current, milestone, index, error);
          index--; // the re-planned steps start where the failed one stood
          continue;
        }
        if (reachedTerminal) {
          completed.push(milestone.key);
          return finish('completed', null);
        }
      }
      completed.push(milestone.key);

      // Completion is the healer's soft notion: it is reported, never used to fail a run.
      const completion = await completionHolds(page, milestone, inputs);
      events.emit('milestone_done', { milestoneKey: milestone.key, holds: completion.holds, detail: completion.detail });
      done.add(milestone.key);
    }

    // A plan without a terminal milestone is done when every milestone is.
    healerBelievedDone = { believed: true, atStep: actions, stepKey: lastStepKey };
    events.emit('healer_done', { believed: true, atStep: actions, stepKey: lastStepKey, detail: 'every milestone ran' });
    return finish('completed', null);
  } catch (error) {
    const stop = classify(error);
    events.emit('stopped', { outcome: stop.runOutcome, code: stop.code, message: stop.message, stepKey: lastStepKey });
    return finish(stop.runOutcome, { code: stop.code, message: stop.message });
  } finally {
    page.off('requestfailed', onRequestFailed);
  }
}

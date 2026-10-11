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
import type { LocatorCache } from './locator-cache';
import { OutcomeError } from './outcome';
import type { PlanSource } from './planner';
import type { Rung3Picker, Rung3Request } from './resolver';
import { concreteTarget, describeTarget, type ConcreteTarget } from './resolve';
import { settle, type SettleConfig } from './settle';
import type { Timings } from './timing';
import { valueOwnersOf } from './tree';

export interface ExecuteInput {
  page: Page;
  /** The app origin; navigation and requests outside it are refused. */
  origin: string;
  startUrl: string;
  /** A hand-written or cached plan, or null to have the planner write one from the landing screen. */
  plan: Plan | null;
  /** Writes the plan and expands milestones that have no steps yet. Absent for hand-written plans. */
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
  /** The plan as executed, expansions included. */
  plan: Plan | null;
  /** Milestones whose steps were written during this run. */
  expanded: string[];
  /** Milestones whose steps all ran through. */
  completed: string[];
}

/** A milestone marked "more" is expanded again on each new screen, at most this many times. */
const MAX_REEXPANSIONS_PER_MILESTONE = 3;

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
  const doneSteps: Step[] = [];
  /** Milestones whose expansion said "more": they continue on a later screen. */
  const needsMore = new Set<string>();
  const reexpansions = new Map<string, number>();
  /** Rung-3 attempts per step and screen, against budgets.maxRung3AttemptsPerStepPerScreen. */
  const rung3Attempts = new Map<string, number>();
  /** Rung-3 answers for later steps of a batch, kept for when the run reaches them on the same screen. */
  const preResolved = new Map<string, { screen: string; outcome: RungOutcome }>();
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
    plan,
    expanded,
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

  const purposeOf = (step: Step, milestone: Milestone): string =>
    ('target' in step && step.target?.hint) || `${step.action} in milestone ${milestone.key}: ${milestone.description}`;

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
      const laterExpectation = expectationFor(later, locators.get(later.key), inputs);
      if (!laterExpectation || preResolved.has(later.key) || attempts(later.key) >= budgets.maxRung3AttemptsPerStepPerScreen) continue;
      if ((await ladder.rung1(laterExpectation, 0)).ok) continue;
      const laterRung2 = await ladder.rung2(laterExpectation);
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

  /** Resolution ladder: rung 1, then rung 2, then rung 3. Rung 5 (milestone re-plan) arrives in P4. */
  async function resolveTarget(milestone: Milestone, index: number, step: Step, escalateFrom: ConcreteTarget | null = null): Promise<Resolution> {
    const expectation = expectationFor(step, locators.get(step.key), inputs);
    if (!expectation) throw new OutcomeError('unresolvable', 'no_target', `${step.key} has no target to resolve`);
    const failures: string[] = [];
    if (escalateFrom) {
      // A rung-2 heal acted but changed nothing: go one rung up, without the element that failed.
      failures.push(`rung 2: ${describeTarget(escalateFrom)} acted without effect`);
      const { candidates } = await ladder.candidatesFor(expectation);
      const others = candidates.filter((candidate) => candidate.name !== escalateFrom.name);
      return { outcome: await rung3(milestone, index, step, expectation, others), expectation, failures };
    }
    const first = await ladder.rung1(expectation, Math.min(2000, stepBudget()));
    if (first.ok) return { outcome: first, expectation, failures };
    failures.push(`rung 1: ${first.reason}`);
    const second = await ladder.rung2(expectation);
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
        throw new OutcomeError('unresolvable', 'unresolved', `${step.key}: no rung could resolve ${target} (${found.failures.join('; ')}); milestone re-planning (rung 5) arrives in P4`);
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
      await perform(page, step, locator, value, origin, stepBudget());
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
      const progress = await checkProgress({ page, step, locator, value, before, after, nextTarget });
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
      throw new OutcomeError('unresolvable', 'no_progress', `${step.key}: ${progress.detail}`);
    }
  }

  /**
   * Steps for this milestone and the next ones on the same screen, written by the planner on the live page.
   * When continuing, the milestone already has steps and the new ones are appended.
   */
  async function expandFrom(current: Plan, milestone: Milestone, done: Set<string>, continuing: boolean): Promise<void> {
    if (!planner) throw new OutcomeError('unresolvable', 'plan_incomplete', `milestone ${milestone.key} has no steps and there is no planner`);
    const start = current.milestones.indexOf(milestone);
    const pending: Milestone[] = continuing ? [milestone] : [];
    for (const candidate of current.milestones.slice(continuing ? start + 1 : start)) {
      if (done.has(candidate.key) || isExpanded(candidate)) break;
      pending.push(candidate);
    }
    const written = await planner.expand(page, pending, doneSteps, committingStep());
    for (const candidate of pending) {
      const expansion = written.get(candidate.key);
      if (!expansion) continue;
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
    const done = new Set<string>();

    for (;;) {
      const milestone = current.milestones.find((m) => !done.has(m.key) && m.dependsOn.every((dependency) => done.has(dependency)));
      if (!milestone) break;
      events.emit('milestone_started', { milestoneKey: milestone.key, description: milestone.description, terminal: milestone.terminal });
      if (!isExpanded(milestone)) await expandFrom(current, milestone, done, false);

      for (let index = 0; ; index++) {
        if (index >= milestone.steps.length) {
          if (!needsMore.has(milestone.key)) break;
          // The milestone continues on this new screen: expand it again, within a bound.
          const count = (reexpansions.get(milestone.key) ?? 0) + 1;
          if (count > MAX_REEXPANSIONS_PER_MILESTONE) {
            throw new OutcomeError('unresolvable', 'expansion_loop', `milestone ${milestone.key} still needed more steps after ${MAX_REEXPANSIONS_PER_MILESTONE} screens`);
          }
          reexpansions.set(milestone.key, count);
          await expandFrom(current, milestone, done, true);
        }
        const step = milestone.steps[index];
        if (!step) break;
        lastStepKey = step.key;
        const reachedTerminal = await timings.measure('browser', step.key, () => runStep(milestone, index, step));
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

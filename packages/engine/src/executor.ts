import { performance } from 'node:perf_hooks';
import {
  emptyRungHistogram,
  isExpanded,
  sameTarget,
  type Budgets,
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
import type { EventLog } from './events';
import { OutcomeError } from './outcome';
import type { PlanSource } from './planner';
import { concreteTarget, describeTarget, resolveRung1, type ConcreteTarget } from './resolve';
import { settle, type SettleConfig } from './settle';
import type { Timings } from './timing';

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
  events: EventLog;
  timings: Timings;
  /** Eval hook, awaited after every action (used to kill the server mid-run). */
  afterAction?: (stepKey: string) => Promise<void>;
}

export interface ExecutionResult {
  outcome: RunOutcome;
  reason: Reason | null;
  terminalAttempted: boolean;
  healerBelievedDone: HealerDone;
  actions: number;
  lastStepKey: string | null;
  rungHistogram: RungHistogram;
  environmentErrors: string[];
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

/**
 * Runs a plan with rung 1 only. Hard gates around every action: budgets, allowlist, settle gate,
 * objective validation, progress check, loop detection. The terminal action runs at most once and
 * hands straight over to the verifier. Every step of the way is a line in events.jsonl.
 */
export async function execute(input: ExecuteInput): Promise<ExecutionResult> {
  const { page, origin, budgets, events, timings, inputs, planner } = input;
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);
  const inputKeys = new Set(input.healer.inputKeys);
  const rungHistogram = emptyRungHistogram();
  const environmentErrors: string[] = [];
  const expanded: string[] = [];
  const completed: string[] = [];
  const doneSteps: Step[] = [];
  /** Milestones whose expansion said "more": they continue on a later screen. */
  const needsMore = new Set<string>();
  const reexpansions = new Map<string, number>();
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
    plan,
    expanded,
    completed,
  });

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
    const commit = committingStep();
    if (!milestone.terminal && commit && sameTarget(step, commit)) {
      const message = `${step.key} would perform the committing action (${commit.key}) outside the terminal milestone`;
      events.emit('refused', { milestoneKey: milestone.key, stepKey: step.key, message });
      throw new OutcomeError('refused', 'commit_outside_terminal', message);
    }

    let locator: Locator | null = null;
    let target = '';
    if ('target' in step && step.target) {
      const concrete = concreteTarget(step.target, inputs);
      target = describeTarget(concrete);
      const result = await resolveRung1(page, concrete, Math.min(2000, stepBudget()));
      if (!result.ok) {
        events.emit('unresolved', {
          milestoneKey: milestone.key,
          stepKey: step.key,
          rung: 1,
          target,
          reason: result.reason,
          validation: result.resolved.validation,
          ms: result.resolved.ms,
        });
        throw new OutcomeError(
          'unresolvable',
          'rung1_unresolved',
          `rung 1 could not resolve ${target}: ${result.reason} (healing rungs 2-5 are not built yet)`,
        );
      }
      rungHistogram['1']++;
      events.emit('resolved', {
        milestoneKey: milestone.key,
        stepKey: step.key,
        rung: 1,
        action: step.action,
        target,
        validation: result.resolved.validation,
        ariaLine: result.resolved.evidence.ariaLine,
        ms: result.resolved.ms,
      });
      locator = result.locator;
    }

    const value = step.action === 'fill' || step.action === 'select' ? (inputs[step.inputRef] ?? null) : null;
    const before = state ?? (await settleNow(`before ${step.key}`));
    if (isTerminalAction) {
      terminalAttempted = true;
      events.emit('terminal_attempted', { milestoneKey: milestone.key, stepKey: step.key });
    }
    actions++;
    const actionStarted = performance.now();
    await perform(page, step, locator, value, origin, stepBudget());
    doneSteps.push(step);
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
      // Terminal rule: whatever happened, the run goes straight to the verifier.
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
    if (!progress.ok) throw new OutcomeError('unresolvable', 'no_progress', `${step.key}: ${progress.detail}`);

    unchangedActions = after.fullHash === before.fullHash ? unchangedActions + 1 : 0;
    if (unchangedActions >= 3) {
      throw new OutcomeError('unresolvable', 'loop_detected', 'the page did not change across three consecutive actions');
    }
    return false;
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

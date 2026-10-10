import { performance } from 'node:perf_hooks';
import {
  emptyRungHistogram,
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
import { concreteTarget, describeTarget, resolveRung1, type ConcreteTarget } from './resolve';
import { settle, type SettleConfig } from './settle';
import type { Timings } from './timing';

export interface ExecuteInput {
  page: Page;
  /** The app origin; navigation and requests outside it are refused. */
  origin: string;
  startUrl: string;
  plan: Plan;
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
}

/** Ends execution with a verdict-relevant outcome. */
class Stop extends Error {
  constructor(
    readonly outcome: RunOutcome,
    readonly reason: Reason,
  ) {
    super(reason.message);
  }
}

/** Connection-level failures only; aborted requests (navigation) and our own blocks are not environment errors. */
const CONNECTION_ERROR =
  /net::ERR_(CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_FAILED|EMPTY_RESPONSE|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TIMED_OUT|ADDRESS_UNREACHABLE|NETWORK_CHANGED)/;

function classify(error: unknown): Reason {
  const message = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim() || 'unknown error';
  if (error instanceof errors.TimeoutError) return { code: 'step_timeout', message };
  if (/has been closed|crash/i.test(message)) return { code: 'browser_crash', message };
  if (/net::ERR_/.test(message)) return { code: 'navigation_error', message };
  return { code: 'unexpected_error', message };
}

/**
 * Runs a plan with rung 1 only. Hard gates around every action: budgets, allowlist, settle gate,
 * objective validation, progress check, loop detection. The terminal action runs at most once and
 * hands straight over to the verifier. Every step of the way is a line in events.jsonl.
 */
export async function execute(input: ExecuteInput): Promise<ExecutionResult> {
  const { page, origin, plan, budgets, events, timings, inputs } = input;
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);
  const inputKeys = new Set(input.healer.inputKeys);
  const rungHistogram = emptyRungHistogram();
  const environmentErrors: string[] = [];
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
  });

  /** Time left for one step: the step budget, capped by what remains of the run budget. */
  const stepBudget = (): number => {
    const left = budgets.runMs - elapsedMs();
    if (left <= 0) throw new Stop('environment', { code: 'run_timeout', message: `run budget of ${budgets.runMs} ms exhausted` });
    return Math.min(budgets.stepMs, left);
  };

  const settleNow = async (label: string): Promise<PageState> => {
    const result = await settle(page, input.settle);
    if (!result.settled) events.emit('settle_timeout', { label, waitedMs: result.waitedMs });
    return result.state;
  };

  /** One step: resolve, act, settle, check progress. Returns true once the terminal action has run. */
  async function runStep(milestone: Milestone, index: number, step: Step): Promise<boolean> {
    const isTerminalAction = milestone.terminal && index === milestone.steps.length - 1;
    if (actions >= budgets.maxActions) {
      throw new Stop('unresolvable', { code: 'action_budget_exhausted', message: `action budget of ${budgets.maxActions} exhausted` });
    }
    const allowed = checkAllowed(step, origin, inputKeys);
    if (!allowed.ok) {
      events.emit('refused', { milestoneKey: milestone.key, stepKey: step.key, message: allowed.message });
      throw new Stop('refused', { code: allowed.code, message: allowed.message });
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
        throw new Stop('unresolvable', {
          code: 'rung1_unresolved',
          message: `rung 1 could not resolve ${target}: ${result.reason} (healing rungs 2-5 are not built yet)`,
        });
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
      throw new Stop('refused', { code: 'left_origin', message: `the page left ${origin} for ${page.url()}` });
    }

    const nextStep = milestone.steps[index + 1];
    const nextTarget: ConcreteTarget | null = nextStep && 'target' in nextStep && nextStep.target ? concreteTarget(nextStep.target, inputs) : null;
    const progress = await checkProgress({ page, step, locator, value, before, after, nextTarget });
    events.emit('progress', { stepKey: step.key, ok: progress.ok, detail: progress.detail });
    if (!progress.ok) throw new Stop('unresolvable', { code: 'no_progress', message: `${step.key}: ${progress.detail}` });

    unchangedActions = after.fullHash === before.fullHash ? unchangedActions + 1 : 0;
    if (unchangedActions >= 3) {
      throw new Stop('unresolvable', { code: 'loop_detected', message: 'the page did not change across three consecutive actions' });
    }
    return false;
  }

  try {
    await timings.measure('browser', 'start', async () => {
      await page.goto(input.startUrl, { timeout: stepBudget() });
      events.emit('navigated', { url: page.url() });
      state = await settleNow('start');
    });
    const done = new Set<string>();

    for (;;) {
      const milestone = plan.milestones.find((m) => !done.has(m.key) && m.dependsOn.every((dependency) => done.has(dependency)));
      if (!milestone) break;
      events.emit('milestone_started', { milestoneKey: milestone.key, description: milestone.description, terminal: milestone.terminal });

      for (const [index, step] of milestone.steps.entries()) {
        lastStepKey = step.key;
        const reachedTerminal = await timings.measure('browser', step.key, () => runStep(milestone, index, step));
        if (reachedTerminal) return finish('completed', null);
      }

      const completion = await completionHolds(page, milestone, inputs);
      events.emit('milestone_done', { milestoneKey: milestone.key, holds: completion.holds, detail: completion.detail });
      if (!completion.holds) {
        throw new Stop('unresolvable', { code: 'milestone_incomplete', message: `milestone ${milestone.key} did not complete: ${completion.detail}` });
      }
      done.add(milestone.key);
    }

    // A plan without a terminal milestone is done when every milestone is.
    healerBelievedDone = { believed: true, atStep: actions, stepKey: lastStepKey };
    events.emit('healer_done', { believed: true, atStep: actions, stepKey: lastStepKey, detail: 'every milestone complete' });
    return finish('completed', null);
  } catch (error) {
    const stop = error instanceof Stop ? error : new Stop('environment', classify(error));
    events.emit('stopped', { outcome: stop.outcome, code: stop.reason.code, message: stop.reason.message, stepKey: lastStepKey });
    return finish(stop.outcome, stop.reason);
  } finally {
    page.off('requestfailed', onRequestFailed);
  }
}

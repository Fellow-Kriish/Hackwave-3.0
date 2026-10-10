import type { CheckResult, OracleResult, Reason, RunRecord, Verdict } from '@hackwave/contracts';

const FAIL_CODES = { state: 'state_delta_failed', binding: 'binding_failed', alerts: 'alerts_present' } as const;
const ERROR_CODES = { state: 'store_unreachable', binding: 'binding_unavailable', alerts: 'alerts_unavailable' } as const;
type CheckName = keyof typeof FAIL_CODES;

/**
 * The decision table, a pure function of the oracle results and the run record.
 * Rows are evaluated top to bottom and the first match wins:
 *   1. any oracle check fails, regardless of healing        -> RED, real bug
 *   2. unresolvable, loop, budget exhausted, action refused  -> RED, unresolvable
 *   3. timeout, crash, navigation/network error, store down  -> GREY, environment
 *   4. oracle passes with at least one heal or re-plan       -> AMBER, UI drift
 *   5. oracle passes with no heal events                     -> GREEN
 * Anything else falls through to GREY: GREY is never a pass.
 */
export function decideVerdict(oracle: OracleResult, run: RunRecord): Verdict {
  const checks: [CheckName, CheckResult][] = [
    ['state', oracle.state],
    ['binding', oracle.binding],
    ['alerts', oracle.alerts],
  ];
  const base = {
    runId: run.runId,
    intentId: run.intentId,
    target: run.target,
    oracle,
    heals: run.heals,
    replans: run.replans,
    healerBelievedDone: run.healerBelievedDone,
    llmCalls: run.llmCalls,
    tokens: run.tokens,
    timings: run.timings,
    rungHistogram: run.rungHistogram,
  };

  const failed = checks.filter(([, result]) => result.status === 'fail');
  if (failed.length > 0) {
    return {
      ...base,
      color: 'RED',
      kind: 'real_bug',
      reasons: failed.map(([name, result]) => ({ code: FAIL_CODES[name], message: result.summary })),
    };
  }

  if (run.outcome === 'unresolvable' || run.outcome === 'refused') {
    const where = run.lastStepKey ? ` (step ${run.lastStepKey})` : '';
    return {
      ...base,
      color: 'RED',
      kind: 'unresolvable',
      reasons: [
        {
          code: run.reason?.code ?? run.outcome,
          message: `${run.reason?.message ?? `run ended ${run.outcome}`}${where}; refused to guess`,
        },
      ],
    };
  }

  const errored = checks.filter(([, result]) => result.status === 'error');
  if (run.outcome === 'environment' || errored.length > 0 || run.environmentErrors.length > 0) {
    const reasons: Reason[] = [];
    if (run.outcome === 'environment' && run.reason) reasons.push(run.reason);
    for (const [name, result] of errored) reasons.push({ code: ERROR_CODES[name], message: result.summary });
    for (const error of run.environmentErrors) reasons.push({ code: 'network_error', message: error });
    if (reasons.length === 0) reasons.push({ code: 'environment', message: 'the run ended with an environment error' });
    return { ...base, color: 'GREY', kind: 'environment', reasons };
  }

  const passed = oracle.evaluated && checks.every(([, result]) => result.status === 'pass' || result.status === 'disabled');
  if (passed && (run.heals.length > 0 || run.replans.length > 0)) {
    return {
      ...base,
      color: 'AMBER',
      kind: 'ui_drift',
      reasons: [{ code: 'ui_drift', message: `oracle passed after ${run.heals.length} heal(s) and ${run.replans.length} re-plan(s)` }],
    };
  }
  if (passed) {
    return { ...base, color: 'GREEN', kind: 'passed', reasons: [{ code: 'passed', message: 'oracle passed with no healing' }] };
  }

  const pending = checks
    .filter(([, result]) => result.status !== 'pass' && result.status !== 'disabled')
    .map(([name, result]) => `${name}: ${result.status}`)
    .join(', ');
  return {
    ...base,
    color: 'GREY',
    kind: 'incomplete',
    reasons: [{ code: 'verifier_incomplete', message: `the oracle could not reach a decision (${pending || 'not evaluated'})` }],
  };
}

import { emptyRungHistogram, type CheckResult, type HealEvent, type OracleResult, type RunRecord } from '@hackwave/contracts';
import { describe, expect, it } from 'vitest';
import { decideVerdict } from './verdict';

const pass: CheckResult = { status: 'pass', summary: 'ok', compared: [] };
const fail = (summary: string): CheckResult => ({ status: 'fail', summary, compared: [] });
const error = (summary: string): CheckResult => ({ status: 'error', summary, compared: [] });
const skipped: CheckResult = { status: 'skipped', summary: 'not evaluated: the terminal action was never attempted', compared: [] };

function oracle(overrides: Partial<OracleResult> = {}): OracleResult {
  return {
    evaluated: true,
    baseline: { count: 0, maxId: null },
    newRecordId: 4821,
    state: pass,
    binding: pass,
    alerts: pass,
    finalUrl: 'http://localhost:5171/order/4821',
    finalHeading: 'Order confirmed #4821',
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run-1',
    intentId: 'checkout-valid-card',
    target: 'http://localhost:5171/',
    startedAt: '2026-10-11T00:00:00.000Z',
    endedAt: '2026-10-11T00:00:05.000Z',
    outcome: 'completed',
    reason: null,
    terminalAttempted: true,
    healerBelievedDone: { believed: true, atStep: 12, stepKey: 'place-order.submit' },
    actions: 12,
    lastStepKey: 'place-order.submit',
    heals: [],
    replans: [],
    rungHistogram: { ...emptyRungHistogram(), '1': 12 },
    llmCalls: { total: 0, byModel: {} },
    tokens: { input: 0, output: 0, byModel: {} },
    timings: { browserMs: 4000, llmMs: 0, totalMs: 5000, steps: [] },
    environmentErrors: [],
    ...overrides,
  };
}

const heal: HealEvent = {
  runId: 'run-1',
  milestoneKey: 'cart',
  stepKey: 'cart.open',
  from: { role: 'button', name: 'Cart (1)' },
  to: { role: 'button', name: 'Your bag' },
  rung: 3,
  reason: 'cached locator not found',
  validation: { unique: true, visible: true, enabled: true, roleMatch: true, inLandmark: true },
  ms: 1400,
};

describe('decision table, one case per row', () => {
  it('row 1: any oracle check fails -> RED, real bug (regardless of healing)', () => {
    const verdict = decideVerdict(
      oracle({ state: fail('expected 1 new record(s) in orders, found 0'), binding: skipped, newRecordId: null }),
      run({ heals: [heal] }),
    );
    expect(verdict).toMatchObject({ color: 'RED', kind: 'real_bug' });
    expect(verdict.reasons).toEqual([{ code: 'state_delta_failed', message: 'expected 1 new record(s) in orders, found 0' }]);
    expect(verdict.healerBelievedDone.believed).toBe(true);
  });

  it('row 2: unresolvable, loop, exhausted budget or refused action -> RED, unresolvable', () => {
    const verdict = decideVerdict(
      oracle({ evaluated: false, state: skipped, binding: skipped, alerts: skipped }),
      run({
        outcome: 'unresolvable',
        terminalAttempted: false,
        lastStepKey: 'cart.open',
        reason: { code: 'rung1_unresolved', message: 'button "Cart (1)" was not found' },
      }),
    );
    expect(verdict).toMatchObject({ color: 'RED', kind: 'unresolvable' });
    expect(verdict.reasons[0]?.code).toBe('rung1_unresolved');
    expect(verdict.reasons[0]?.message).toBe('button "Cart (1)" was not found (step cart.open); refused to guess');

    const refused = decideVerdict(
      oracle({ evaluated: false, state: skipped, binding: skipped, alerts: skipped }),
      run({ outcome: 'refused', terminalAttempted: false, reason: { code: 'left_origin', message: 'navigated to https://evil.example' } }),
    );
    expect(refused).toMatchObject({ color: 'RED', kind: 'unresolvable' });
  });

  it('row 3: timeout, crash, network error or unreadable store -> GREY, environment', () => {
    const verdict = decideVerdict(
      oracle({ state: error('the orders store could not be read: fetch failed'), binding: skipped, alerts: skipped, newRecordId: null }),
      run({ environmentErrors: ['POST http://localhost:5179/api/orders failed: net::ERR_CONNECTION_REFUSED'] }),
    );
    expect(verdict).toMatchObject({ color: 'GREY', kind: 'environment' });
    expect(verdict.reasons.map((reason) => reason.code)).toEqual(['store_unreachable', 'network_error']);

    const timeout = decideVerdict(
      oracle({ evaluated: false, state: skipped, binding: skipped, alerts: skipped }),
      run({ outcome: 'environment', terminalAttempted: false, reason: { code: 'run_timeout', message: 'run budget of 90000 ms exhausted' } }),
    );
    expect(timeout).toMatchObject({ color: 'GREY', kind: 'environment' });
    expect(timeout.reasons[0]?.code).toBe('run_timeout');
  });

  it('row 4: oracle passes with at least one heal or re-plan -> AMBER, UI drift', () => {
    expect(decideVerdict(oracle(), run({ heals: [heal] }))).toMatchObject({ color: 'AMBER', kind: 'ui_drift' });
  });

  it('row 5: oracle passes with no heal events -> GREEN', () => {
    expect(decideVerdict(oracle(), run())).toMatchObject({ color: 'GREEN', kind: 'passed' });
  });
});

describe('row order and the safety net', () => {
  it('an oracle failure outranks environment errors', () => {
    const verdict = decideVerdict(oracle({ alerts: fail('error alert on the final page: Payment declined') }), run({ environmentErrors: ['x'] }));
    expect(verdict.color).toBe('RED');
  });

  it('an environment error outranks a passing oracle: GREY is never a pass', () => {
    const verdict = decideVerdict(oracle(), run({ environmentErrors: ['GET http://localhost:5171/api/products failed: net::ERR_CONNECTION_RESET'] }));
    expect(verdict.color).toBe('GREY');
  });

  it('a disabled check does not block a pass', () => {
    expect(decideVerdict(oracle({ binding: { status: 'disabled', summary: 'off', compared: [] } }), run()).color).toBe('GREEN');
  });

  it('anything undecided falls through to GREY, never GREEN', () => {
    const verdict = decideVerdict(oracle({ evaluated: false, state: skipped, binding: skipped, alerts: skipped }), run());
    expect(verdict).toMatchObject({ color: 'GREY', kind: 'incomplete' });
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractError, parsePlan, VerdictSchema, type Plan, type Step, type Verdict } from '@hackwave/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { promptsCheck } from './doctor';
import { createExplainer, explainInput } from './explain';
import { markdownToHtml } from './html';
import { idFromGoal, scaffoldIntent } from './init';
import { formatLint, jsonPathLines, lintIntentText } from './intent-lint';
import { LlmAdapter, loadPrompt, readManifest, type PromptFile } from './llm';
import type { FetchLike } from './llm/providers';
import { resolveLlmSettings } from './llm/settings';
import { loadIntent } from './load';
import { findRepoRoot } from './paths';
import { lineDiff, planDiff, prBlock, renderReport, summary, whatChanged, type ReportContext } from './report';
import { valueOwnersOf } from './tree';

const root = findRepoRoot();
const config = loadConfig(root);

describe('intent lint', () => {
  const bad = ['{', '  "id": "Bad Intent",', '  "goal": "buy",', '  "inputs": { "product": "Trail Runner", "card": { "number": 4242 } },', '  "oracle": { "state": { "store": "orders", "expectedNewCount": 1, "match": { "total": 1299 } }, "extra": true }', '}'].join('\n');

  it('says what is wrong, where, and what to write instead', () => {
    const result = lintIntentText(bad);
    expect(result.intent).toBeNull();
    expect(result.problems.map((problem) => [problem.line, problem.path, problem.message])).toEqual([
      [2, 'id', '"Bad Intent" is not an id: use lower-case words joined by hyphens, e.g. "bad-intent"'],
      [3, 'goal', 'too short: write the goal as one plain sentence (at least 10 characters)'],
      [4, 'inputs.card.number', 'must be text in quotes, got a number (groups are one level deep)'],
      [5, 'oracle.ui', 'missing: add "ui": { "newRecordIdVisible": true, "noAlerts": true }'],
      [5, 'oracle.extra', 'unknown field; allowed here: state, ui'],
    ]);
    // Input values are never echoed.
    expect(formatLint('bad.json', result)).not.toContain('Trail Runner');
    expect(formatLint('bad.json', result)).toMatch(/^bad\.json is invalid \(5 problems\):\n {2}line 2 {3}id/);
  });

  it('points at the line and column of a JSON syntax error', () => {
    const [problem] = lintIntentText('{\n  "id": "x",\n  "goal": "a goal that is long enough", \n}').problems;
    expect(problem).toMatchObject({ path: '', line: 4 });
    expect(problem?.message).toMatch(/^not valid JSON \(column \d+\): /);
  });

  it('passes the real intents, and run and eval load them through the same checks', () => {
    for (const file of ['checkout.json', 'checkout-missing-product.json']) {
      expect(lintIntentText(readFileSync(join(root, 'intents', file), 'utf8')).problems).toEqual([]);
    }
    const dir = mkdtempSync(join(tmpdir(), 'lint-test-'));
    try {
      writeFileSync(join(dir, 'bad.json'), bad);
      expect(() => loadIntent(join(dir, 'bad.json'))).toThrow(ContractError);
      expect(() => loadIntent(join(dir, 'bad.json'))).toThrow(/is invalid \(5 problems\):[\s\S]*oracle\.ui {2,}missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps JSON paths to lines', () => {
    expect([...jsonPathLines('{\n "a": 1,\n "b": {\n  "c": [\n   "x",\n   "y"\n  ]\n }\n}')]).toEqual([
      ['', 1],
      ['a', 2],
      ['b', 3],
      ['b.c', 4],
      ['b.c.0', 5],
      ['b.c.1', 6],
    ]);
  });
});

describe('init', () => {
  it('derives an id from the goal and scaffolds an intent that lint rejects until every TODO is replaced', () => {
    const goal = 'As a shopper, buy a gift card for a friend and reach the order confirmation.';
    expect(idFromGoal(goal)).toBe('buy-gift-card-friend-order');
    const text = scaffoldIntent(goal);
    const scaffold = lintIntentText(text);
    expect(scaffold.problems.map((problem) => problem.path)).toEqual(['inputs.example', 'inputs.group.field', 'oracle.state.store', 'oracle.state.match.items.0']);
    expect(scaffold.problems.every((problem) => problem.message.startsWith('still a placeholder'))).toBe(true);

    const filled = JSON.parse(text) as { inputs: Record<string, unknown>; oracle: { state: { store: string; match: { items: string[] } } } };
    filled.inputs = { giftCard: 'Birthday', recipient: { email: 'friend@example.com' } };
    filled.oracle.state.store = 'orders';
    filled.oracle.state.match.items = ['Birthday'];
    expect(lintIntentText(JSON.stringify(filled)).intent?.id).toBe('buy-gift-card-friend-order');
  });
});

const fill = (key: string, name: string, inputRef: string): Step => ({ key, action: 'fill', target: { role: 'textbox', name, synonyms: [] }, inputRef });
const click = (key: string, name: string): Step => ({ key, action: 'click', target: { role: 'button', name, synonyms: [] } });

function plan(milestones: { key: string; steps: Step[]; dependsOn?: string[] }[]): Plan {
  return parsePlan({
    intentId: 'checkout-valid-card',
    goalHash: 'g',
    promptHash: 'p',
    createdAt: '2026-10-11T00:00:00.000Z',
    milestones: milestones.map((milestone) => ({ ...milestone, description: `${milestone.key} things`, completion: { kind: 'filled' } })),
  });
}

function verdict(overrides: Partial<Verdict>): Verdict {
  return VerdictSchema.parse({
    runId: '20261011T120000Z-checkout-valid-card-localhost-5172',
    intentId: 'checkout-valid-card',
    target: 'http://localhost:5172/',
    color: 'GREEN',
    kind: 'passed',
    reasons: [{ code: 'passed', message: 'oracle passed with no healing' }],
    oracle: {
      evaluated: true,
      baseline: { count: 0, maxId: null },
      newRecordId: 4821,
      state: { status: 'pass', summary: '1 new record 4821 in orders', compared: [] },
      binding: { status: 'pass', summary: 'new record id 4821 is shown on the final page', compared: [] },
      alerts: { status: 'pass', summary: 'no error alerts on the final page', compared: [] },
      finalUrl: 'http://localhost:5172/orders/ORD-4821',
      finalHeading: 'Thanks! Order ORD-4821 is on its way',
    },
    heals: [],
    replans: [],
    healerBelievedDone: { believed: true, atStep: 14, stepKey: 'place-order.submit' },
    llmCalls: { total: 0, cached: 0, byModel: {} },
    tokens: { input: 0, output: 0, byModel: {} },
    timings: { browserMs: 1000, llmMs: 0, totalMs: 1200, steps: [] },
    rungHistogram: { '1': 14, '2': 0, '3': 0, '4': 0, '5': 0 },
    ...overrides,
  });
}

const broken = () =>
  verdict({
    color: 'RED',
    kind: 'real_bug',
    reasons: [{ code: 'state_delta_failed', message: 'expected 1 new record(s) in orders, found 0 after waiting 5000 ms (baseline 0)' }],
    oracle: {
      ...verdict({}).oracle,
      newRecordId: null,
      state: { status: 'fail', summary: 'expected 1 new record(s) in orders, found 0 after waiting 5000 ms (baseline 0)', compared: [] },
      binding: { status: 'skipped', summary: 'not evaluated: there is no single new record to look for', compared: [] },
    },
  });

describe('report pieces', () => {
  it('diffs lines by longest common subsequence', () => {
    expect(lineDiff(['a', 'b', 'c'], ['x', 'b', 'c', 'd'])).toEqual(['- a', '+ x', '  b', '  c', '+ d']);
  });

  it('shows the order the milestones ran in, skips, and each changed milestone as a diff', () => {
    const before = plan([
      { key: 'shipping', steps: [fill('shipping.name', 'Full name', 'shipping.name')] },
      { key: 'payment', steps: [fill('payment.card-number', 'Card number', 'card.number')] },
    ]);
    const after = plan([
      { key: 'shipping', steps: [fill('shipping.name', 'Full name', 'shipping.name')] },
      { key: 'payment', steps: [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Continue to payment'), fill('payment.card-number', 'Card number', 'card.number')] },
    ]);
    const lines = planDiff(before, after, { started: ['payment', 'shipping'], skipped: [], expanded: ['payment'], replanned: ['payment'] });
    expect(lines).toContain('Milestones ran as payment → shipping (planned shipping → payment): each time, the ready milestone that started on the current screen went first.');
    expect(lines.join('\n')).toContain(
      ['### payment (re-planned, expanded on the live screen)', '', '```diff', '+ payment.phone: fill textbox "Phone" <- shipping.phone', '+ payment.continue: click button "Continue to payment"', '  payment.card-number: fill textbox "Card number" <- card.number', '```'].join('\n'),
    );
    expect(planDiff(before, before, { started: ['shipping', 'payment'], skipped: [], expanded: [], replanned: [] })).toEqual([]);
    expect(planDiff(null, after, { started: [], skipped: [], expanded: [], replanned: [] })[2]).toMatch(/^The planner wrote this plan in this run/);
  });

  it('writes a PR description from the heals and re-plans, and a one-line summary per verdict', () => {
    const amber = verdict({
      color: 'AMBER',
      kind: 'ui_drift',
      heals: [
        {
          runId: 'r',
          milestoneKey: 'cart',
          stepKey: 'cart.open',
          from: { role: 'button', name: 'Cart ({n})' },
          to: { role: 'button', name: 'Your bag' },
          rung: 3,
          reason: 'x',
          validation: { unique: true, visible: true, enabled: true, roleMatch: true, inLandmark: true },
          ms: 1,
        },
      ],
      replans: [{ milestoneKey: 'payment', reason: 'r', oldSteps: [], newSteps: [fill('payment.phone', 'Phone', 'shipping.phone')], attempt: 1, rationale: 'The page now asks for a phone number first.' }],
    });
    const text = prBlock(amber, { intentFile: 'intents/checkout.json', locatorsFile: 'runs/locators/checkout-valid-card.json', planFile: 'runs/plans/checkout-valid-card.json' }).join('\n');
    expect(text).toContain('## Heal UI drift in checkout-valid-card');
    expect(text).toContain('| cart.open | button "Cart ({n})" | button "Your bag" | rung 3, fast model |');
    expect(text).toContain('- payment: fill textbox "Phone" <- shipping.phone. The page now asks for a phone number first.');
    expect(text).toContain('`pnpm engine run --intent intents/checkout.json --target http://localhost:5172/` is GREEN with 0 model calls');
    expect(summary(amber, { planSource: 'cache' })).toBe('Passed on the system of record after the UI changed: 1 heal(s) and 1 re-plan(s). The fix is below: review the cache diff and commit it.');
    expect(summary(broken(), { planSource: 'cache' })).toBe(
      'The page said "Thanks! Order ORD-4821 is on its way", but the system of record disagrees: expected 1 new record(s) in orders, found 0 after waiting 5000 ms (baseline 0).',
    );
  });

  it('says what changed in plain words, from what the run saw', () => {
    const validation = { unique: true, visible: true, enabled: true, roleMatch: true, inLandmark: true };
    const amber = verdict({
      color: 'AMBER',
      kind: 'ui_drift',
      heals: [
        { runId: 'r', milestoneKey: 'cart', stepKey: 'cart.add', from: { role: 'button', name: 'Add to cart' }, to: { role: 'button', name: 'Add to cart' }, rung: 2, reason: 'x', validation, ms: 1, moved: 'from main to region "New arrivals"' },
        { runId: 'r', milestoneKey: 'cart', stepKey: 'cart.open', from: { role: 'button', name: 'Cart ({n})' }, to: { role: 'button', name: 'Your bag' }, rung: 3, reason: 'x', validation, ms: 1 },
      ],
      replans: [{ milestoneKey: 'payment', reason: 'r', oldSteps: [], newSteps: [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Continue to payment')], attempt: 1, rationale: 'the page asks for a phone number first.' }],
    });
    const before = plan([
      { key: 'shipping', steps: [fill('shipping.name', 'Full name', 'shipping.name')] },
      { key: 'payment', steps: [fill('payment.card-number', 'Card number', 'card.number')] },
    ]);
    expect(whatChanged(amber, { planBefore: before, started: ['payment', 'shipping'], skipped: [] })).toEqual([
      'The button "Add to cart" moved to another part of the page (from main to region "New arrivals").',
      'The button "Cart (…)" is now called "Your bag".',
      "The flow's order changed: it now goes payment → shipping; the plan said shipping → payment.",
      'The page now asks for a new field, textbox "Phone" (filled from shipping.phone).',
      'The payment part of the flow had to be rebuilt from the goal: the page asks for a phone number first.',
    ]);
  });

  it('puts both notions of done and the hypothesis at the top of a RED report', () => {
    const context: ReportContext = {
      config,
      record: { runId: 'r', intentId: 'i', target: 't', startedAt: '', endedAt: '', outcome: 'completed', reason: null, terminalAttempted: true, healerBelievedDone: { believed: true, atStep: 14, stepKey: 'place-order.submit' }, actions: 14, lastStepKey: 'place-order.submit', rungHistogram: { '1': 14, '2': 0, '3': 0, '4': 0, '5': 0 }, environmentErrors: [], heals: [], replans: [], llmCalls: { total: 0, cached: 0, byModel: {} }, tokens: { input: 0, output: 0, byModel: {} }, timings: { browserMs: 0, llmMs: 0, totalMs: 0, steps: [] } },
      intentFile: 'intents/checkout.json',
      planFile: 'runs/plans/checkout-valid-card.json',
      planSource: 'cache',
      runDir: 'runs/x',
      llmMode: 'replay',
      locatorsFile: 'runs/locators/checkout-valid-card.json',
      locatorsUpdated: [],
      locatorChanges: [],
      reusedHealsFrom: [],
      planBefore: null,
      planAfter: null,
      planCached: false,
      started: [],
      skipped: [],
      expanded: [],
      replanned: [],
      explanation: { hypothesis: 'The confirmation page rendered an order id, but no order reached the store; the order POST handler likely returns success without saving.' },
    };
    const report = renderReport(broken(), context);
    const order = ['# RED · real bug', '> The page said', '## Two notions of done', '- Healer (soft, reads only the page): believed done at step 14', '- Verifier (hard, reads the system of record): RED · real bug: state delta failed', '## Config in force', '## Oracle checks', '## Hypothesis', '> The confirmation page rendered'];
    let at = -1;
    for (const marker of order) {
      const next = report.indexOf(marker);
      expect(next, marker).toBeGreaterThan(at);
      at = next;
    }
  });
});

describe('report.html', () => {
  it('renders the reporter markdown safely, with the verdict colour and coloured diff lines', () => {
    const html = markdownToHtml(['# AMBER · UI drift', '', '> Passed <b>after</b> **4** heals', '', '| Step | After |', '| --- | --- |', '| cart.open | button "Your bag" \\| x |', '', '```diff', '- old', '+ new', '```'].join('\n'), 'AMBER · checkout');
    expect(html).toContain('<h1 class="verdict" style="background:#9a6700">AMBER · UI drift</h1>');
    expect(html).toContain('<blockquote>Passed &lt;b&gt;after&lt;/b&gt; <strong>4</strong> heals</blockquote>');
    expect(html).toContain('<td>button &quot;Your bag&quot; | x</td>');
    expect(html).toContain('<span class="del">- old</span>\n<span class="add">+ new</span>');
    expect(html).not.toContain('<b>');
  });
});

describe('RED hypothesis', () => {
  const owners = valueOwnersOf({ 'card.number': '4242 4242 4242 4242', 'shipping.name': 'Kartik Test' });
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'explain-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const adapter = (mode: 'record' | 'replay', fetchImpl: FetchLike) =>
    new LlmAdapter({
      settings:
        mode === 'replay'
          ? resolveLlmSettings(config, { LLM_MODE: 'replay' }, readManifest(dir))
          : resolveLlmSettings(config, { LLM_MODE: 'record', LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_MODEL_STRONG: 's', LLM_MODEL_FAST: 'f' }, null),
      config,
      cacheDir: dir,
      maxCalls: 8,
      deadline: () => Date.now() + 60_000,
      fetchImpl,
    });

  it('sees only evidence that is the same on every run with this outcome, with input values as {key}', () => {
    const withName = broken();
    withName.reasons[0] = { code: 'state_delta_failed', message: 'no order for Kartik Test' };
    const input = explainInput(withName, owners);
    expect(input).toContain('VERDICT: RED · real_bug');
    expect(input).toContain('- state_delta_failed: no order for {shipping.name}');
    expect(input).toContain('FINAL PAGE: heading "Thanks! Order ORD-4821 is on its way" at path /orders/ORD-4821');
    expect(input).toContain('HEALER (reads only the page): believed it was done after step place-order.submit');
    expect(input).not.toMatch(/Kartik|localhost|5172|20261011T/);
  });

  it('uses the fast tier, replays a recorded hypothesis, and a missing recording means none rather than a failed run', async () => {
    const hypothesis = 'The page confirmed an order but none reached the store; the order POST handler likely skips the save.';
    let sent = '';
    const fetchImpl: FetchLike = async (_url, init) => {
      sent = String(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ hypothesis }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    };
    const prompt = loadPrompt(root, 'explain');
    const recording = adapter('record', fetchImpl);
    expect(await createExplainer({ llm: recording, prompt, valueOwners: owners }).explain(broken())).toEqual({ hypothesis });
    expect(recording.tierFor('explain')).toBe('fast');
    expect(sent).toContain('"model":"f"');

    const offline: FetchLike = async () => {
      throw new Error('replay must not touch the network');
    };
    const replaying = createExplainer({ llm: adapter('replay', offline), prompt, valueOwners: owners });
    expect(await replaying.explain(broken())).toEqual({ hypothesis });
    const other = broken();
    other.reasons[0] = { code: 'state_delta_failed', message: 'new record in orders does not match: 4821.total 999 ≠ expected 1299' };
    expect(await replaying.explain(other)).toEqual({ skipped: 'not in the replay cache; record it with --llm-mode record' });
  });
});

describe('doctor: prompts against the replay cache', () => {
  const prompts = (['planner', 'resolve', 'explain'] as const).map((name) => loadPrompt(root, name));
  const manifest = (hashes: Record<string, string>) => ({ version: 1 as const, tiers: { strong: null, fast: null }, prompts: hashes, updatedAt: '' });
  const hashes = (list: PromptFile[]) => Object.fromEntries(list.map((prompt) => [prompt.name, prompt.hash]));

  it('passes when every recorded prompt is unchanged, and an unrecorded explain prompt never blocks replay', () => {
    const recorded = hashes(prompts.filter((prompt) => prompt.name !== 'explain'));
    expect(promptsCheck(prompts, manifest(recorded), 'replay')).toMatchObject({ status: 'pass', detail: expect.stringContaining('never recorded: explain') });
  });

  it('fails in replay when a recorded prompt changed since recording', () => {
    const recorded = { ...hashes(prompts), resolve: 'an older hash' };
    expect(promptsCheck(prompts, manifest(recorded), 'replay')).toMatchObject({ status: 'fail', detail: expect.stringContaining('changed since recording: resolve') });
    expect(promptsCheck(prompts, manifest(recorded), 'record').status).toBe('pass');
  });
});

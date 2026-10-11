import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlan, type Milestone, type Plan, type Step } from '@hackwave/contracts';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { EventLog, readEvents } from './events';
import { execute, type ExecuteInput } from './executor';
import { LlmAdapter, loadPrompt } from './llm';
import type { FetchLike } from './llm/providers';
import { resolveLlmSettings } from './llm/settings';
import { LocatorCache } from './locator-cache';
import { findRepoRoot } from './paths';
import { cacheablePlan } from './plan-cache';
import type { Expansion, PlanSource } from './planner';
import { createReplanner, type Replan, type Replanner, type ReplanRequest } from './replanner';
import { Timings } from './timing';

const config = loadConfig();
const inputs = { 'shipping.name': 'Asha Rao', 'shipping.phone': '9876543210', 'card.number': '4242 4242 4242 4242' };
const healer = { id: 'replan-test', goal: 'Buy the shoes and reach the confirmation.', inputKeys: Object.keys(inputs) };

// A two-screen checkout that changed like v2: a required Phone field on shipping, payment on its own screen,
// and a renamed final button. The phone error is a role=alert, which the progress check ignores as a live region.
const SHIPPING = `<main><h1>Shipping</h1><form aria-label="Shipping">
  <label for="n">Full name</label><input id="n">
  <label for="p">Phone</label><input id="p">
  <button type="button" id="go">Continue to payment</button><div id="err"></div></form></main>
  <script>document.getElementById('go').onclick = () => {
    if (!document.getElementById('p').value) { document.getElementById('err').innerHTML = '<p role="alert">Phone is required</p>'; return; }
    location.href = '/pay';
  };</script>`;
const PAY = `<main><h1>Payment</h1><form aria-label="Payment">
  <label for="c">Card number</label><input id="c"><button type="button" id="pay">Pay ₹1,299</button></form></main>
  <script>document.getElementById('pay').onclick = () => { document.querySelector('main').innerHTML = '<h1>Thanks! Order 1</h1>'; };</script>`;

const fill = (key: string, name: string, inputRef: string): Step => ({ key, action: 'fill', target: { role: 'textbox', name, synonyms: [] }, inputRef });
const click = (key: string, name: string): Step => ({ key, action: 'click', target: { role: 'button', name, synonyms: [] } });

/** The v1-shaped plan: payment right after shipping on one screen, "Place order" to finish. */
function v1Plan(): Plan {
  return parsePlan({
    intentId: 'replan-test',
    goalHash: 'g',
    promptHash: 'hand-written',
    createdAt: '2026-10-11T00:00:00.000Z',
    milestones: [
      { key: 'shipping', description: 'Enter the shipping address.', completion: { kind: 'filled' }, steps: [fill('shipping.name', 'Full name', 'shipping.name')] },
      { key: 'payment', description: 'Enter the card.', dependsOn: ['shipping'], completion: { kind: 'filled' }, steps: [fill('payment.number', 'Card number', 'card.number')] },
      {
        key: 'place-order',
        description: 'Place the order.',
        dependsOn: ['payment'],
        terminal: true,
        completion: { kind: 'heading', text: 'Thanks' },
        steps: [click('place-order.submit', 'Place order')],
      },
    ],
  });
}

/** A re-planner that answers from a script and keeps what it was asked. */
function scriptedReplanner(answers: Replan[]): Replanner & { asked: ReplanRequest[] } {
  const asked: ReplanRequest[] = [];
  return {
    asked,
    async replan(_page, request) {
      asked.push(structuredClone(request));
      const answer = answers[asked.length - 1];
      if (!answer) throw new Error(`no scripted answer for re-plan ${asked.length}`);
      return answer;
    },
  };
}

/** A planner that only continues milestones, as after a re-plan with "more". */
function continuingPlanner(steps: Record<string, Step[]>): PlanSource & { later: string[][] } {
  const later: string[][] = [];
  return {
    later,
    plan: async () => {
      throw new Error('not used');
    },
    async expand(_page, pending, _done, _commit, laterMilestones = []) {
      later.push(laterMilestones.map((milestone: Milestone) => milestone.key));
      return new Map<string, Expansion>(pending.filter((m) => steps[m.key]).map((m) => [m.key, { steps: steps[m.key] ?? [], more: false }]));
    },
  };
}

describe('rung 5: milestone re-plan', () => {
  let server: Server;
  let origin: string;
  let browser: Browser;
  let dir: string;
  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="en"><body>${request.url === '/pay' ? PAY : SHIPPING}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch();
    dir = mkdtempSync(join(tmpdir(), 'replan-test-'));
  });
  afterAll(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  let page: Page;
  let events: EventLog;
  let runCount = 0;
  beforeEach(async () => {
    page = await (await browser.newContext()).newPage();
    events = new EventLog(join(dir, `run-${++runCount}.jsonl`));
  });

  const run = (overrides: Partial<ExecuteInput>) =>
    execute({
      page,
      origin,
      startUrl: `${origin}/`,
      plan: v1Plan(),
      healer,
      inputs,
      budgets: config.budgets,
      settle: { sampleGapMs: 50, maxWaitMs: 500 },
      ladder: config.ladder,
      locators: LocatorCache.load(dir, `replan-test-${runCount}`),
      runId: `run-${runCount}`,
      events,
      timings: new Timings(),
      ...overrides,
    });

  it('re-plans payment around the new required field, continues on the next screen, and re-plans the renamed final click', async () => {
    const replanner = scriptedReplanner([
      {
        steps: [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Continue to payment')],
        more: true,
        reason: 'the page now asks for a phone number before the payment screen',
      },
      { steps: [click('place-order.pay', 'Pay ₹1,299')], more: false, reason: 'the final button is now labelled with the amount' },
    ]);
    const planner = continuingPlanner({ payment: [fill('payment.number', 'Card number', 'card.number')] });
    const result = await run({ replanner, planner });

    expect(result).toMatchObject({ outcome: 'completed', terminalAttempted: true, replanned: ['payment', 'place-order'], expanded: ['payment'] });
    expect(result.replans.map((event) => [event.milestoneKey, event.attempt, event.newSteps.map((step) => step.key)])).toEqual([
      ['payment', 1, ['payment.phone', 'payment.continue']],
      ['place-order', 1, ['place-order.pay']],
    ]);
    expect(result.rungHistogram['5']).toBe(2);
    expect(result.plan?.milestones.find((m) => m.key === 'payment')?.steps.map((step) => step.key)).toEqual(['payment.phone', 'payment.continue', 'payment.number']);

    const [first, second] = replanner.asked;
    expect(first).toMatchObject({ index: 0, attempt: 1, maxAttempts: 2, commit: { key: 'place-order.submit' } });
    expect(first?.failures.join(' ')).toContain('Card number');
    expect(first?.later.map((m) => m.key)).toEqual(['place-order']);
    expect([...(first?.taken ?? [])].sort()).toEqual(['place-order.submit', 'shipping.name']);
    // The terminal milestone's own re-plan carries no commit restriction: its last step is the commit.
    expect(second).toMatchObject({ commit: null, later: [] });
    // The continuation was told which milestones are not its to write.
    expect(planner.later).toEqual([['place-order']]);
    // Nothing the re-planner saw carries an input value.
    expect(JSON.stringify(replanner.asked)).not.toMatch(/Asha|9876543210|4242/);
  }, 30_000);

  it('a re-planned step uses its own target, not an older cache entry that shares its key', async () => {
    const locators = LocatorCache.load(dir, 'replan-stale');
    const stale = { role: 'button' as const, name: 'Next' };
    locators.set('payment.continue', {
      locator: stale,
      fingerprint: { ...stale, landmark: { role: 'form', name: 'Shipping' }, siblingText: [], href: null, type: null },
      rung: 1,
      updatedByRun: 'older-run',
      updatedAt: '2026-10-10T00:00:00.000Z',
    });
    const replanner = scriptedReplanner([
      { steps: [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Continue to payment')], more: false, reason: 'phone first' },
      { steps: [], more: false, reason: 'stop after the screen changed' },
    ]);
    const result = await run({ replanner, locators });
    const continued = readEvents(events.file).find((event) => event.type === 'resolved' && event.stepKey === 'payment.continue');
    expect(continued).toMatchObject({ rung: 1, target: 'button "Continue to payment"' });
    expect(result.heals.map((heal) => heal.stepKey)).not.toContain('payment.continue');
    expect(locators.get('payment.continue')?.locator).toEqual({ role: 'button', name: 'Continue to payment' });
  }, 30_000);

  it('stops RED on a re-plan that starts with the step that just failed', async () => {
    const replanner = scriptedReplanner([{ steps: [fill('payment.number', 'Card number', 'card.number')], more: false, reason: 'try again' }]);
    const result = await run({ replanner });
    expect(result).toMatchObject({ outcome: 'unresolvable', reason: { code: 'replan_loop' }, replans: [], terminalAttempted: false });
  });

  it('re-plans after a click that changes nothing, then refuses to go past the budget', async () => {
    const plan = v1Plan();
    const shipping = plan.milestones[0] as Milestone;
    shipping.steps.push(click('shipping.continue', 'Continue to payment'));
    const replanner = scriptedReplanner([
      { steps: [fill('shipping.name-again', 'Full name', 'shipping.name'), click('shipping.continue', 'Continue to payment')], more: false, reason: 'retype the name' },
      { steps: [fill('shipping.name-once-more', 'Full name', 'shipping.name'), click('shipping.continue', 'Continue to payment')], more: false, reason: 'still nothing' },
    ]);
    const result = await run({ plan, replanner });
    expect(result).toMatchObject({ outcome: 'unresolvable', reason: { code: 'replan_budget_exhausted' } });
    expect(result.replans).toHaveLength(2);
    expect(replanner.asked[0]?.failures[0]).toBe('click button "Continue to payment" had no effect: the page only showed an alert: "Phone is required"');
    // The click that changed nothing is not reported to the re-planner as done.
    expect(replanner.asked[0]?.done.map((step) => step.key)).toEqual(['shipping.name']);
  }, 30_000);

  it('stops RED when the re-planner finds no way, with its reason', async () => {
    const replanner = scriptedReplanner([{ steps: [], more: false, reason: 'there is no card field anywhere on this page' }]);
    const result = await run({ replanner });
    expect(result).toMatchObject({ outcome: 'unresolvable', reason: { code: 'replan_impossible' } });
    expect(result.reason?.message).toContain('there is no card field anywhere on this page');
  });

  it('without a re-planner, an unresolved step stops the run as before', async () => {
    const result = await run({});
    expect(result).toMatchObject({ outcome: 'unresolvable', reason: { code: 'unresolved' } });
    expect(result.reason?.message).toContain('no re-planner (rung 5) is available');
  });

  it('skips a milestone whose completion already holds and takes a ready milestone that starts on this screen first', async () => {
    const plan = parsePlan({
      ...v1Plan(),
      milestones: [
        // Already true on the shipping screen: skipped, its impossible step never runs.
        { key: 'intro', description: 'Reach the shipping screen.', completion: { kind: 'heading', text: 'Shipping' }, steps: [click('intro.go', 'Start')] },
        { key: 'payment', description: 'Enter the card.', dependsOn: ['intro'], completion: { kind: 'filled' }, steps: [fill('payment.number', 'Card number', 'card.number')] },
        { key: 'shipping', description: 'Enter the address.', dependsOn: ['intro'], completion: { kind: 'filled' }, steps: [fill('shipping.name', 'Full name', 'shipping.name')] },
      ],
    });
    const replanner = scriptedReplanner([{ steps: [], more: false, reason: 'stop here' }]);
    const result = await run({ plan, replanner });
    const types = readEvents(events.file).map((event) => `${event.type}:${String(event.milestoneKey ?? '')}`);
    expect(types).toContain('milestone_skipped:intro');
    expect(types).toContain('milestone_reordered:shipping');
    expect(types.indexOf('milestone_started:shipping')).toBeLessThan(types.indexOf('milestone_started:payment'));
    expect(result.completed).toEqual(['intro', 'shipping']);
  });
});

describe('re-planner prompt and reply checks', () => {
  const root = findRepoRoot();
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent(SHIPPING);
  });
  afterAll(async () => {
    await browser.close();
  });

  const milestone: Milestone = { key: 'payment', description: 'Enter the card.', dependsOn: ['shipping'], completion: { kind: 'filled' }, terminal: false, steps: [fill('payment.number', 'Card number', 'card.number')] };
  const later: Milestone = { key: 'place-order', description: 'Place the order.', dependsOn: ['payment'], completion: { kind: 'heading', text: 'Thanks' }, terminal: true, steps: [click('place-order.submit', 'Continue to payment')] };

  function adapterWith(replies: string[]) {
    const sent: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      sent.push((JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[1]?.content ?? '');
      return new Response(JSON.stringify({ choices: [{ message: { content: replies[sent.length - 1] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    };
    const cacheDir = mkdtempSync(join(tmpdir(), 'replanner-test-'));
    const llm = new LlmAdapter({
      settings: resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_MODEL_STRONG: 's', LLM_MODEL_FAST: 'f' }, null),
      config,
      cacheDir,
      maxCalls: 8,
      deadline: () => Date.now() + 60_000,
      fetchImpl,
    });
    return { llm, sent, cleanup: () => rmSync(cacheDir, { recursive: true, force: true }) };
  }

  const request = (): ReplanRequest => ({
    milestone,
    index: 0,
    failures: [
      'rung 1: plan target textbox "Card number" not found',
      'rung 3: the fast model found no candidate that does this step',
      'an earlier click showed an alert: "No delivery for ASHA RAO yet"',
    ],
    done: [fill('shipping.name', 'Full name', 'shipping.name')],
    attempt: 1,
    maxAttempts: 2,
    previous: [],
    later: [later],
    commit: later.steps[0] ?? null,
    taken: new Set(['shipping.name', 'place-order.submit']),
  });

  it('uses the strong tier, shows the failure and the later milestones, and rejects off-screen targets and the commit click', async () => {
    const bad = { steps: [fill('payment.number', 'Card number', 'card.number'), click('payment.go', 'Continue to payment')], more: false, reason: 'x' };
    const stillBad = { steps: [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Card details')], more: true, reason: 'y' };
    const fixed = { steps: [fill('payment.phone', 'Phone', 'shipping.phone')], more: false, reason: 'the phone is required first' };
    const { llm, sent, cleanup } = adapterWith([JSON.stringify(bad), JSON.stringify(stillBad)]);
    try {
      const replanner = createReplanner({ llm, prompt: loadPrompt(root, 'replan'), healer, inputValues: inputs, tree: config.tree });
      // First reply: an off-screen target and the commit click (it is the terminal milestone's step) in payment.
      await expect(replanner.replan(page, request())).rejects.toMatchObject({ code: 'llm_invalid_output' });
      expect(llm.tierFor('replanner')).toBe('strong');
      expect(sent[0]).toContain('MILESTONE TO RE-PLAN: payment: Enter the card. (attempt 1 of 2)');
      expect(sent[0]).toContain('STEP THAT FAILED: payment.number: fill textbox "Card number" <- card.number');
      expect(sent[0]).toContain('- rung 1: plan target textbox "Card number" not found');
      expect(sent[0]).toContain('- an earlier click showed an alert: "No delivery for {shipping.name} yet"');
      expect(sent[0]).toContain('LATER MILESTONES (not yours; never write their steps):\n- place-order (terminal): Place the order.');
      expect(sent[1]).toContain('there is no textbox "Card number" on this screen');
      expect(sent[1]).toContain('this is the click that commits the goal; it belongs only to the terminal milestone');
      expect(sent.join('\n')).not.toMatch(/Asha|9876543210|4242/);

      // A fresh call: "more" after a fill is rejected, the retry is accepted.
      const second = adapterWith([JSON.stringify({ ...fixed, more: true }), JSON.stringify(fixed)]);
      try {
        const again = createReplanner({ llm: second.llm, prompt: loadPrompt(root, 'replan'), healer, inputValues: inputs, tree: config.tree });
        expect(await again.replan(page, request())).toEqual(fixed);
        expect(second.sent[1]).toContain('"more": true is only for steps that end with the click that leaves this screen');
      } finally {
        second.cleanup();
      }
    } finally {
      cleanup();
    }
  });

  it('accepts no steps with a reason: the milestone cannot be carried on from here', async () => {
    const { llm, cleanup } = adapterWith([JSON.stringify({ steps: [], more: false, reason: 'the product is not on this page' })]);
    try {
      const replanner = createReplanner({ llm, prompt: loadPrompt(root, 'replan'), healer, inputValues: inputs, tree: config.tree });
      expect(await replanner.replan(page, request())).toEqual({ steps: [], more: false, reason: 'the product is not on this page' });
    } finally {
      cleanup();
    }
  });
});

describe('plan cache after a re-plan', () => {
  it('keeps re-planned steps of a milestone that ran through and puts back one that did not', () => {
    const original = v1Plan();
    const executed = structuredClone(original);
    const [shipping, payment] = executed.milestones as [Milestone, Milestone, Milestone];
    shipping.steps = [fill('shipping.name', 'Full name', 'shipping.name'), fill('shipping.phone', 'Phone', 'shipping.phone')];
    payment.steps = [click('payment.continue', 'Continue to payment')];
    const cached = cacheablePlan(executed, [], ['shipping'], { keys: ['shipping', 'payment'], original });
    expect(cached.milestones[0]?.steps.map((step) => step.key)).toEqual(['shipping.name', 'shipping.phone']);
    expect(cached.milestones[1]).toEqual(original.milestones[1]);
  });
});

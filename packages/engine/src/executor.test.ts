import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlan, type Milestone, type Step } from '@hackwave/contracts';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkProgress } from './act';
import { checkAllowed } from './allowlist';
import { capturePage, stripLiveRegions } from './aria';
import { completionHolds } from './completion';
import { loadConfig } from './config';
import { EventLog } from './events';
import { execute } from './executor';
import { createLadder, expectationFor } from './ladder';
import { LocatorCache } from './locator-cache';
import { concreteTarget, describeTarget } from './resolve';
import { settle } from './settle';
import { Timings } from './timing';

describe('stripLiveRegions', () => {
  it('drops status, alert and timer subtrees and keeps everything else', () => {
    const snapshot = [
      '- banner:',
      '  - button "Cart (1)"',
      '- main:',
      '  - status: Trail Runner added',
      '  - alert:',
      '    - heading "Fix" [level=2]',
      '    - listitem: Enter phone',
      '  - heading "Checkout" [level=1]',
      '  - timer: 00:59',
      '  - textbox "Card number": "4242"',
    ].join('\n');
    expect(stripLiveRegions(snapshot)).toBe(
      ['- banner:', '  - button "Cart (1)"', '- main:', '  - heading "Checkout" [level=1]', '  - textbox "Card number": "4242"'].join('\n'),
    );
  });
});

describe('allowlist', () => {
  const origin = 'http://localhost:5171';
  const keys = new Set(['card.number']);
  it('allows in-origin navigation and known input keys only', () => {
    expect(checkAllowed({ key: 'go.home', action: 'navigate', path: '/' }, origin, keys).ok).toBe(true);
    expect(checkAllowed({ key: 'go.away', action: 'navigate', path: '//evil.example/x' }, origin, keys).ok).toBe(false);
    const fill = (inputRef: string): Step => ({ key: 'payment.number', action: 'fill', target: { role: 'textbox', name: 'Card number', synonyms: [] }, inputRef });
    expect(checkAllowed(fill('card.number'), origin, keys).ok).toBe(true);
    expect(checkAllowed(fill('card.upi'), origin, keys)).toMatchObject({ ok: false, code: 'action_refused' });
  });

  it('refuses Enter in a text field, which could submit a form outside the terminal rule', () => {
    const press = (role: string, pressKey: 'Enter' | 'Tab'): Step => ({ key: 'form.key', action: 'press', target: { role, name: 'Full name', synonyms: [] }, pressKey });
    expect(checkAllowed(press('textbox', 'Enter'), origin, keys)).toMatchObject({ ok: false, code: 'action_refused' });
    expect(checkAllowed(press('textbox', 'Tab'), origin, keys).ok).toBe(true);
    expect(checkAllowed(press('searchbox', 'Enter'), origin, keys).ok).toBe(true);
  });
});

describe('terminal rule', () => {
  it('refuses the committing click from any milestone but the terminal one, before acting', async () => {
    let clicks = 0;
    const server = createServer((request, response) => {
      if (request.method === 'POST') clicks++;
      response.setHeader('content-type', 'text/html');
      response.end('<main><h1>Pay</h1><button onclick="fetch(\'/order\', { method: \'POST\' })">Place order</button></main>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const dir = mkdtempSync(join(tmpdir(), 'terminal-test-'));
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      const click = (key: string): Step => ({ key, action: 'click', target: { role: 'button', name: 'Place order', synonyms: [] } });
      const plan = parsePlan({
        intentId: 'i',
        goalHash: 'g',
        promptHash: 'hand-written',
        createdAt: '2026-10-11T00:00:00.000Z',
        milestones: [
          { key: 'payment', description: 'd', completion: { kind: 'filled' }, steps: [click('payment.sneaky')] },
          { key: 'place-order', description: 'd', dependsOn: ['payment'], completion: { kind: 'heading', text: 'Done' }, terminal: true, steps: [click('place-order.submit')] },
        ],
      });
      const result = await execute({
        page,
        origin,
        startUrl: `${origin}/`,
        plan,
        healer: { id: 'i', goal: 'g', inputKeys: [] },
        inputs: {},
        budgets: loadConfig().budgets,
        settle: { sampleGapMs: 50, maxWaitMs: 500 },
        ladder: loadConfig().ladder,
        locators: LocatorCache.load(dir, 'i'),
        runId: 'terminal-test',
        events: new EventLog(join(dir, 'events.jsonl')),
        timings: new Timings(),
      });
      expect(result).toMatchObject({ outcome: 'refused', reason: { code: 'commit_outside_terminal' }, actions: 0, terminalAttempted: false });
      expect(clicks).toBe(0);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('on a real page', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    page = await (await browser.newContext()).newPage();
    await page.setContent(`
      <header><button>Cart (1)</button></header>
      <main>
        <h1>Shoes</h1>
        <article aria-labelledby="a"><h2 id="a">Trail Runner</h2><button>Add to cart</button></article>
        <article aria-labelledby="b"><h2 id="b">City Sneaker</h2><button>Add to cart</button></article>
        <label for="n">Card number</label><input id="n">
        <button disabled>Pay ₹1,299</button>
        <p role="status" id="s"></p>
      </main>`);
  });

  /** Rung 1 with no cache entry: the step's own target, validated. */
  const rung1 = (name: string, within?: { role: string; name: string }) => {
    const ladder = createLadder({ page, inputs: {}, valueOwners: new Map(), ladder: loadConfig().ladder });
    const step: Step = { key: 'probe.click', action: 'click', target: { role: 'button', name, synonyms: [], ...(within ? { within } : {}) } };
    const expectation = expectationFor(step, undefined, {});
    if (!expectation) throw new Error('unreachable');
    return ladder.rung1(expectation, 200);
  };

  it('resolves a scoped target uniquely and refuses an ambiguous one', async () => {
    const scoped = await rung1('Add to cart', { role: 'article', name: 'Trail Runner' });
    expect(scoped.ok).toBe(true);
    expect(scoped.validation).toEqual({ unique: true, visible: true, enabled: true, roleMatch: true, inLandmark: true });
    expect(scoped.fingerprint).toMatchObject({ role: 'button', name: 'Add to cart', landmark: { role: 'main' }, siblingText: ['Trail Runner'] });

    expect(await rung1('Add to cart')).toMatchObject({ ok: false, reason: 'plan target button "Add to cart" matches 2 elements' });
  });

  it('uses exact names: "Cart" is not "Cart (1)" and never "Add to cart"', async () => {
    expect(await rung1('Cart')).toMatchObject({ ok: false, reason: 'plan target button "Cart" not found' });
    expect((await rung1('Cart (1)')).ok).toBe(true);
  });

  it('fails validation on a disabled target and on a missing scope', async () => {
    expect(await rung1('Pay ₹1,299')).toMatchObject({ ok: false, reason: 'plan target button "Pay ₹1,299" is disabled' });
    expect(await rung1('Add to cart', { role: 'article', name: 'Moon Boot' })).toMatchObject({
      ok: false,
      reason: 'plan target button "Add to cart": scope article "Moon Boot" not found',
    });
  });

  it('fills nameRef scopes from inputs without putting values in the plan', () => {
    const concrete = concreteTarget({ role: 'button', name: 'Add to cart', synonyms: [], within: { role: 'article', nameRef: 'product' } }, { product: 'Trail Runner' });
    expect(describeTarget(concrete)).toBe('button "Add to cart" in article "Trail Runner"');
  });

  it('settles on a stable page and ignores live-region churn', async () => {
    await page.evaluate(() => {
      let n = 0;
      setInterval(() => {
        document.getElementById('s')!.textContent = `tick ${n++}`;
      }, 40);
    });
    const result = await settle(page, { sampleGapMs: 100, maxWaitMs: 1000 });
    expect(result.settled).toBe(true);
  });

  it('gives up on a page that never settles, within the ceiling', async () => {
    await page.evaluate(() => {
      let n = 0;
      setInterval(() => {
        document.querySelector('h1')!.textContent = `Shoes ${n++}`;
      }, 30);
    });
    const started = Date.now();
    const result = await settle(page, { sampleGapMs: 100, maxWaitMs: 500 });
    expect(result.settled).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('checks progress by read-back for fills and by change for clicks', async () => {
    const field = page.getByRole('textbox', { name: 'Card number', exact: true });
    const fill: Step = { key: 'payment.number', action: 'fill', target: { role: 'textbox', name: 'Card number', synonyms: [] }, inputRef: 'card.number' };
    const before = await capturePage(page);
    await field.fill('4242 4242 4242 4242');
    const after = await capturePage(page);
    expect(await checkProgress({ page, step: fill, locator: field, value: '4242 4242 4242 4242', before, after, nextTarget: null })).toMatchObject({ ok: true });
    expect(await checkProgress({ page, step: fill, locator: field, value: '4000 0000 0000 0002', before, after, nextTarget: null })).toEqual({
      ok: false,
      detail: 'the field read back a different value',
    });

    const click: Step = { key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart (1)', synonyms: [] } };
    const still = await capturePage(page);
    expect(await checkProgress({ page, step: click, locator: null, value: null, before: still, after: still, nextTarget: null })).toMatchObject({ ok: false });
    expect(
      await checkProgress({ page, step: click, locator: null, value: null, before: still, after: still, nextTarget: { role: 'heading', name: 'Shoes' } }),
    ).toMatchObject({ ok: true, detail: 'next target is visible' });
  });

  it('reads milestone completion from the aria tree', async () => {
    const milestone = (completion: Milestone['completion'], steps: Step[] = []): Milestone => ({
      key: 'm',
      description: 'd',
      dependsOn: [],
      terminal: false,
      completion,
      steps,
    });
    expect((await completionHolds(page, milestone({ kind: 'heading', text: 'Shoes' }), {})).holds).toBe(true);
    expect((await completionHolds(page, milestone({ kind: 'heading', text: 'Order confirmed' }), {})).holds).toBe(false);
    expect((await completionHolds(page, milestone({ kind: 'heading', text: ['Order confirmed', 'Shoes'] }), {})).holds).toBe(true);
    expect((await completionHolds(page, milestone({ kind: 'visible', role: 'button', name: 'Cart (1)' }), {})).holds).toBe(true);

    const fill: Step = { key: 'payment.number', action: 'fill', target: { role: 'textbox', name: 'Card number', synonyms: [] }, inputRef: 'card.number' };
    const inputs = { 'card.number': '4242 4242 4242 4242' };
    expect((await completionHolds(page, milestone({ kind: 'filled' }, [fill]), inputs)).holds).toBe(false);
    await page.getByRole('textbox', { name: 'Card number', exact: true }).fill(inputs['card.number']);
    expect((await completionHolds(page, milestone({ kind: 'filled' }, [fill]), inputs)).holds).toBe(true);
  });
});

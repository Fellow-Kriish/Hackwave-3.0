import type { Milestone, Step } from '@hackwave/contracts';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkProgress } from './act';
import { checkAllowed } from './allowlist';
import { capturePage, stripLiveRegions } from './aria';
import { completionHolds } from './completion';
import { concreteTarget, describeTarget, resolveRung1 } from './resolve';
import { settle } from './settle';

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

  const target = (name: string, within?: { role: string; name: string }) => ({ role: 'button', name, ...(within ? { within } : {}) });

  it('resolves a scoped target uniquely and refuses an ambiguous one', async () => {
    const scoped = await resolveRung1(page, target('Add to cart', { role: 'article', name: 'Trail Runner' }), 200);
    expect(scoped.ok).toBe(true);
    expect(scoped.resolved.validation).toEqual({ unique: true, visible: true, enabled: true, roleMatch: true, inLandmark: true });
    expect(scoped.resolved.evidence.ariaLine).toBe('- button "Add to cart"');

    const ambiguous = await resolveRung1(page, target('Add to cart'), 200);
    expect(ambiguous).toMatchObject({ ok: false, reason: 'matches 2 elements' });
  });

  it('uses exact names: "Cart" is not "Cart (1)" and never "Add to cart"', async () => {
    expect(await resolveRung1(page, target('Cart'), 200)).toMatchObject({ ok: false, reason: 'not found' });
    expect((await resolveRung1(page, target('Cart (1)'), 200)).ok).toBe(true);
  });

  it('fails validation on a disabled target and on a missing scope', async () => {
    expect(await resolveRung1(page, target('Pay ₹1,299'), 200)).toMatchObject({ ok: false, reason: 'disabled' });
    expect(await resolveRung1(page, target('Add to cart', { role: 'article', name: 'Moon Boot' }), 200)).toMatchObject({
      ok: false,
      reason: 'scope article "Moon Boot" not found',
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
    expect((await completionHolds(page, milestone({ kind: 'visible', role: 'button', name: 'Cart (1)' }), {})).holds).toBe(true);

    const fill: Step = { key: 'payment.number', action: 'fill', target: { role: 'textbox', name: 'Card number', synonyms: [] }, inputRef: 'card.number' };
    const inputs = { 'card.number': '4242 4242 4242 4242' };
    expect((await completionHolds(page, milestone({ kind: 'filled' }, [fill]), inputs)).holds).toBe(false);
    await page.getByRole('textbox', { name: 'Card number', exact: true }).fill(inputs['card.number']);
    expect((await completionHolds(page, milestone({ kind: 'filled' }, [fill]), inputs)).holds).toBe(true);
  });
});

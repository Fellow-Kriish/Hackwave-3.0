import type { Milestone, Step } from '@hackwave/contracts';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkProgress } from './act';
import { capturePage } from './aria';
import { looksLikeCommit } from './commit';
import { completionHolds, lastScreenFills } from './completion';
import { loadConfig } from './config';
import { describeElement } from './fingerprint';
import { createLadder, expectationFor } from './ladder';
import { namePattern } from './resolve';
import { nameSimilarity, normalizeName, templateVolatileNumbers } from './similarity';
import { sameValue } from './values';

const config = loadConfig();
const fill = (key: string, name: string, inputRef: string): Step => ({ key, action: 'fill', target: { role: 'textbox', name, synonyms: [] }, inputRef });
const click = (key: string, name: string): Step => ({ key, action: 'click', target: { role: 'button', name, synonyms: [] } });

describe('numbers in names', () => {
  it('treats only prices and bracketed counts as changeable', () => {
    expect(normalizeName('Pay ₹1,299')).toBe('pay #');
    expect(normalizeName('Cart (12)')).toBe('cart #');
    expect(normalizeName('Size 10')).toBe('size 10');
    expect(nameSimilarity('Size 9', 'Size 10')).toBeLessThan(0.85);
    expect(nameSimilarity('Pay ₹1,299', 'Pay ₹999')).toBe(1);
    expect(nameSimilarity('Pay', 'Pay ₹1,299')).toBe(0.95);
  });

  it('templates prices and counts, and {n} matches numbers with separators', () => {
    expect(templateVolatileNumbers('Pay ₹1,299')).toBe('Pay ₹{n}');
    expect(templateVolatileNumbers('Cart (3)')).toBe('Cart ({n})');
    expect(templateVolatileNumbers('Air Max 90')).toBe('Air Max 90');
    expect(namePattern('Pay ₹{n}').test('Pay ₹1,299')).toBe(true);
    expect(namePattern('Pay ₹{n}').test('Pay ₹12.50')).toBe(true);
    expect(namePattern('Pay ₹{n}').test('Pay later')).toBe(false);
  });
});

describe('commit-like controls', () => {
  it('knows paying, placing and confirming from moving on to a payment screen', () => {
    for (const name of ['Place order', 'Pay ₹1,299', 'Pay now', 'Buy now', 'Confirm order', 'Complete purchase', 'Purchase']) expect(looksLikeCommit(name), name).toBe(true);
    for (const name of ['Proceed to payment', 'Continue to payment', 'PayPal', 'Add to cart', 'Checkout', 'Your bag']) expect(looksLikeCommit(name), name).toBe(false);
  });
});

describe('typed values the app formats', () => {
  it('matches without spaces, dashes and brackets, but never an empty value', () => {
    expect(sameValue('4242424242424242', '4242 4242 4242 4242')).toBe(true);
    expect(sameValue('(987) 654-3210', '9876543210')).toBe(true);
    expect(sameValue('12/29', '1229')).toBe(true);
    expect(sameValue('4000', '4242')).toBe(false);
    expect(sameValue('', ' ')).toBe(false);
  });
});

describe('filled means the last screen', () => {
  const milestone = (steps: Step[]): Milestone => ({ key: 'payment', description: 'd', dependsOn: [], completion: { kind: 'filled' }, terminal: false, steps });

  it('looks at the fill steps after the last click only', () => {
    const steps = [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Continue'), fill('payment.number', 'Card number', 'card.number')];
    expect(lastScreenFills(milestone(steps)).map((step) => step.key)).toEqual(['payment.number']);
    expect(lastScreenFills(milestone([fill('a', 'A', 'x'), click('b', 'B')])).map((step) => step.key)).toEqual(['a']);
    expect(lastScreenFills(milestone([click('b', 'B')]))).toEqual([]);
  });
});

describe('on a page', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    page = await browser.newPage();
  });

  it('checks a filled milestone against its last screen, allowing for formatting', async () => {
    await page.setContent('<form aria-label="Payment"><label for="c">Card number</label><input id="c" value="4242424242424242"></form>');
    const steps = [fill('payment.phone', 'Phone', 'shipping.phone'), click('payment.continue', 'Continue'), fill('payment.number', 'Card number', 'card.number')];
    const result = await completionHolds(page, { key: 'payment', description: 'd', dependsOn: [], completion: { kind: 'filled' }, terminal: false, steps }, { 'card.number': '4242 4242 4242 4242', 'shipping.phone': '1' });
    expect(result).toEqual({ holds: true, detail: 'every field holds its input' });
  });

  it('leaves a field\'s own label out of its fingerprint', async () => {
    await page.setContent('<form aria-label="Payment"><h2>Payment</h2><label for="c">Card number</label><input id="c"><label for="e">Expiry</label><input id="e"></form>');
    const { fingerprint } = await describeElement(page.getByRole('textbox', { name: 'Card number' }), 'textbox');
    expect(fingerprint.siblingText).toEqual(['Payment', 'Expiry']);
  });

  it('caches a healed price as {n} only while that still names one control', async () => {
    const ladder = createLadder({ page, inputs: {}, valueOwners: new Map(), ladder: config.ladder });
    const submit: Step = { key: 'place-order.submit', action: 'click', target: { role: 'button', name: 'Place order', synonyms: ['Pay'] } };
    await page.setContent('<main><button>Pay ₹1,299</button></main>');
    const one = expectationFor(submit, undefined, {});
    if (!one) throw new Error('unreachable');
    expect((await ladder.rung2(one)).cachedLocator).toEqual({ role: 'button', name: 'Pay ₹{n}' });

    await page.setContent('<main><button>Pay ₹1,299</button><button>Pay ₹999 with points</button><button>Pay ₹999</button></main>');
    const two = expectationFor({ ...submit, target: { role: 'button', name: 'Pay ₹1,299', synonyms: [] } }, undefined, {});
    if (!two) throw new Error('unreachable');
    const result = await ladder.rung1(two, 200);
    expect(result.cachedLocator).toEqual({ role: 'button', name: 'Pay ₹1,299' });
  });

  it('never heals onto a commit-like control outside the terminal milestone', async () => {
    await page.setContent('<main><button>Pay ₹1,299</button><button>Continue to payment</button></main>');
    const ladder = createLadder({ page, inputs: {}, valueOwners: new Map(), ladder: config.ladder });
    const step = click('payment.go', 'Pay');
    const outside = expectationFor(step, undefined, {}, false);
    const terminal = expectationFor(step, undefined, {}, true);
    if (!outside || !terminal) throw new Error('unreachable');
    expect((await ladder.candidatesFor(outside)).candidates.map((candidate) => candidate.name)).toEqual(['Continue to payment']);
    expect((await ladder.candidatesFor(terminal)).candidates.map((candidate) => candidate.name)).toContain('Pay ₹1,299');
  });

  it('counts a successful request that changes data as progress for a click', async () => {
    await page.setContent('<main><button>Save</button></main>');
    const state = await capturePage(page);
    const step = click('profile.save', 'Save');
    expect(await checkProgress({ page, step, locator: null, value: null, before: state, after: state, nextTarget: null, appRequests: ['POST /api/profile'] })).toEqual({ ok: true, detail: 'the app sent POST /api/profile' });
    expect((await checkProgress({ page, step, locator: null, value: null, before: state, after: state, nextTarget: null, appRequests: [] })).ok).toBe(false);
  });
});

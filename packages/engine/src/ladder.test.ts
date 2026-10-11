import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlan, type Step } from '@hackwave/contracts';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { EventLog } from './events';
import { execute } from './executor';
import { describeElement } from './fingerprint';
import { createLadder, expectationFor, type ScoredCandidate } from './ladder';
import { LlmAdapter } from './llm';
import type { FetchLike } from './llm/providers';
import { resolveLlmSettings } from './llm/settings';
import { LocatorCache, type LocatorCacheEntry } from './locator-cache';
import { findRepoRoot } from './paths';
import { createRung3Picker, type Rung3Picker, type Rung3Request } from './resolver';
import { nameSimilarity, normalizeName, setOverlap } from './similarity';
import { Timings } from './timing';
import { loadPrompt } from './llm';

const config = loadConfig();
const inputs = { product: 'Trail Runner' };
const owners = new Map([['trail runner', 'product']]);

const V1 = `
  <header><nav aria-label="Main"><a href="/">Shop</a><button>Cart (0)</button></nav></header>
  <main><h1>Shoes</h1>
    <article aria-labelledby="a"><h2 id="a">Trail Runner</h2><button id="add-a" class="btn">Add to cart</button></article>
    <article aria-labelledby="b"><h2 id="b">City Sneaker</h2><button id="add-b" class="btn">Add to cart</button></article>
  </main>`;
const V2 = `
  <header><nav aria-label="Main"><a href="/">New arrivals</a><button aria-label="Your bag">👜</button></nav></header>
  <main><section aria-labelledby="h"><h2 id="h">New arrivals</h2>
    <article aria-labelledby="a"><h3 id="a">Trail Runner</h3><button>Add to cart</button></article>
    <article aria-labelledby="b"><h3 id="b">City Sneaker</h3><button>Add to cart</button></article>
  </section></main>`;

const addStep: Step = { key: 'cart.add', action: 'click', target: { role: 'button', name: 'Add to cart', synonyms: [], within: { role: 'article', nameRef: 'product' } } };
const cartStep: Step = { key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart (0)', synonyms: ['Cart', 'Bag'], hint: 'opens the cart' } };

describe('similarity', () => {
  it('normalises counts, prices and punctuation', () => {
    expect(normalizeName('Cart (1)')).toBe('cart #');
    expect(normalizeName('Cart ({n})')).toBe('cart #');
    expect(normalizeName('Pay ₹1,299')).toBe('pay #');
  });

  it('scores renames low enough for rung 3, and counts and case as the same name', () => {
    expect(nameSimilarity('Cart (1)', 'Cart (3)')).toBe(1);
    expect(nameSimilarity('Add to cart', 'Add to Cart')).toBe(1);
    expect(nameSimilarity('Checkout', 'Proceed to payment')).toBeLessThan(0.5);
    expect(nameSimilarity('Place order', 'Pay ₹1,299')).toBeLessThan(0.5);
    expect(nameSimilarity('Bag', 'Your bag')).toBeLessThan(0.85);
    expect(setOverlap(['Trail Runner', 'Payment'], ['Trail Runner'])).toBe(0.5);
  });
});

describe('ladder on real pages', () => {
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
  });

  const ladderFor = () => createLadder({ page, inputs, valueOwners: owners, ladder: config.ladder });

  /** What a v1 run would have cached for a step. */
  async function cachedOnV1(step: Step): Promise<LocatorCacheEntry> {
    await page.setContent(V1);
    const ladder = ladderFor();
    const expectation = expectationFor(step, undefined, inputs);
    if (!expectation) throw new Error('unreachable');
    const first = await ladder.rung1(expectation, 200);
    if (!first.ok || !first.cachedLocator || !first.fingerprint) throw new Error(`v1 rung 1 failed: ${first.reason}`);
    return { locator: first.cachedLocator, fingerprint: first.fingerprint, rung: 1, updatedByRun: 'v1-run', updatedAt: '2026-10-11T00:00:00.000Z' };
  }

  it('fingerprints the landmark, the nearest named container and nearby headings', async () => {
    await page.setContent(V2);
    const description = await describeElement(page.getByRole('article', { name: 'Trail Runner' }).getByRole('button'), 'button');
    expect(description).toEqual({
      fingerprint: { role: 'button', name: 'Add to cart', landmark: { role: 'region', name: 'New arrivals' }, siblingText: ['Trail Runner'], href: null, type: null },
      container: { role: 'article', name: 'Trail Runner' },
    });
  });

  it('caches scopes named after inputs as nameRef', async () => {
    const entry = await cachedOnV1(addStep);
    expect(entry.locator).toEqual({ role: 'button', name: 'Add to cart', within: { role: 'article', nameRef: 'product' } });
    expect(entry.fingerprint.landmark).toEqual({ role: 'main', name: null });
  });

  it('rung 1 refuses a cached element that moved landmark; rung 2 heals it with the fingerprint', async () => {
    const entry = await cachedOnV1(addStep);
    await page.setContent(V2);
    const ladder = ladderFor();
    const expectation = expectationFor(addStep, entry, inputs);
    if (!expectation) throw new Error('unreachable');
    const first = await ladder.rung1(expectation, 200);
    expect(first).toMatchObject({ ok: false, reason: 'cached locator button "Add to cart" moved from main to region "New arrivals"' });
    const second = await ladder.rung2(expectation);
    expect(second).toMatchObject({ ok: true, rung: 2, target: { role: 'button', name: 'Add to cart', within: { role: 'article', name: 'Trail Runner' } } });
    expect(second.score).toBeGreaterThanOrEqual(0.85);
    expect(second.cachedLocator).toEqual({ role: 'button', name: 'Add to cart', within: { role: 'article', nameRef: 'product' } });
  });

  it('rung 1 with no time to wait checks once instead of waiting forever', async () => {
    await page.setContent(V2);
    const missing: Step = { key: 'payment.expiry', action: 'fill', target: { role: 'textbox', name: 'Expiry (MM/YY)', synonyms: [] }, inputRef: 'card.expiry' };
    const expectation = expectationFor(missing, undefined, inputs);
    if (!expectation) throw new Error('unreachable');
    const started = Date.now();
    expect(await ladderFor().rung1(expectation, 0)).toMatchObject({ ok: false, reason: 'plan target textbox "Expiry (MM/YY)" not found' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('rung 2 refuses a rename it cannot score and leaves the candidates for rung 3', async () => {
    const entry = await cachedOnV1(cartStep);
    await page.setContent(V2);
    const expectation = expectationFor(cartStep, entry, inputs);
    if (!expectation) throw new Error('unreachable');
    const second = await ladderFor().rung2(expectation);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/below 0\.85/);
    expect(second.candidates.map((candidate) => candidate.name)).toContain('Your bag');
  });

  it('rung 2 refuses a tie instead of guessing', async () => {
    await page.setContent(V2);
    const unscoped: Step = { key: 'cart.add', action: 'click', target: { role: 'button', name: 'Add to cart', synonyms: [] } };
    const expectation = expectationFor(unscoped, undefined, inputs);
    if (!expectation) throw new Error('unreachable');
    expect((await ladderFor().rung2(expectation)).reason).toMatch(/only 0 ahead/);
  });

  it('never offers an element an earlier step already acted on, on this screen', async () => {
    await page.setContent(V2);
    const cartOpen: Step = { key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart ({n})', synonyms: [] } };
    const expectation = expectationFor(cartOpen, undefined, inputs);
    if (!expectation) throw new Error('unreachable');
    const used = [{ role: 'button', name: 'Add to cart', within: { role: 'article', name: 'Trail Runner' } }];
    const names = (await ladderFor().candidatesFor(expectation, used)).candidates.map((candidate) => `${candidate.name} @ ${candidate.container?.name ?? '-'}`);
    expect(names).not.toContain('Add to cart @ Trail Runner');
    expect(names).toContain('Add to cart @ City Sneaker');
    expect(names).toContain('Your bag @ Main');
    expect((await ladderFor().rung2(expectation, used)).candidates.map((candidate) => candidate.id)).toEqual(names.map((_, index) => `c${index + 1}`));
  });

  it('never looks outside a scope named after an input', async () => {
    await page.setContent(V2);
    const expectation = expectationFor(addStep, undefined, { product: 'Moon Boot' });
    if (!expectation) throw new Error('unreachable');
    const second = await createLadder({ page, inputs: { product: 'Moon Boot' }, valueOwners: new Map(), ladder: config.ladder }).rung2(expectation);
    expect(second).toMatchObject({ ok: false, candidates: [] });
    expect(second.reason).toContain('required scope article "Moon Boot" is not on this screen');
  });

  it('rung 3 sends candidates, never input values, and validates the answer', async () => {
    const entry = await cachedOnV1(cartStep);
    await page.setContent(V2);
    const expectation = expectationFor(cartStep, entry, inputs);
    if (!expectation) throw new Error('unreachable');
    const { candidates } = await ladderFor().candidatesFor(expectation);
    const bag = candidates.find((candidate) => candidate.name === 'Your bag') as ScoredCandidate;
    const sent: string[] = [];
    const replies = [JSON.stringify({ steps: [{ step: 'cart.open', candidate: 'c99' }] }), JSON.stringify({ steps: [{ step: 'cart.open', candidate: bag.id }] })];
    const fetchImpl: FetchLike = async (_url, init) => {
      sent.push((JSON.parse(String(init.body)) as { messages: { content: string }[] }).messages[1]?.content ?? '');
      return new Response(JSON.stringify({ choices: [{ message: { content: replies[sent.length - 1] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    };
    const cacheDir = mkdtempSync(join(tmpdir(), 'rung3-test-'));
    try {
      const llm = new LlmAdapter({
        settings: resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_MODEL_STRONG: 's', LLM_MODEL_FAST: 'f' }, null),
        config,
        cacheDir,
        maxCalls: 8,
        deadline: () => Date.now() + 60_000,
        fetchImpl,
      });
      const picker = createRung3Picker({
        llm,
        prompt: loadPrompt(findRepoRoot(), 'resolve'),
        healer: { id: 'i', goal: 'Buy the Trail Runner shoes.', inputKeys: ['product'] },
        tree: config.tree,
        valueOwners: owners,
        candidatesPerStep: config.ladder.candidatesPerStep,
        fullTreeBelowScore: config.ladder.fullTreeBelowScore,
      });
      const picks = await picker.pick(page, [{ expectation, purpose: 'opens the cart', candidates }]);
      expect(picks.get('cart.open')?.name).toBe('Your bag');
      expect(llm.tierFor('resolver')).toBe('fast');
      expect(sent[0]).toContain('before: button "Cart (0)" · inside navigation "Main"');
      expect(sent[0]).toContain(`${bag.id}: button "Your bag"`);
      expect(sent[0]).toContain('(= input product)');
      expect(sent[1]).toContain('"c99" is not a candidate of cart.open');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('executor heals and writes the fix', () => {
  let server: Server;
  let origin: string;
  let html = V1;
  let dir: string;
  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html lang="en"><body>${html}<script>
        for (const b of document.querySelectorAll('button')) b.addEventListener('click', () => { const s = document.getElementById('status') || document.body.appendChild(Object.assign(document.createElement('p'), { id: 'status' })); s.textContent = 'clicked ' + (b.getAttribute('aria-label') || b.textContent); });
      </script></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dir = mkdtempSync(join(tmpdir(), 'heal-test-'));
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const plan = parsePlan({
    intentId: 'heal-test',
    goalHash: 'g',
    promptHash: 'hand-written',
    createdAt: '2026-10-11T00:00:00.000Z',
    milestones: [{ key: 'cart', description: 'Add the product.', completion: { kind: 'heading', text: 'Shoes' }, steps: [addStep] }],
  });

  async function runOnce(runId: string) {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      const locators = LocatorCache.load(dir, 'heal-test');
      const result = await execute({
        page,
        origin,
        startUrl: `${origin}/`,
        plan,
        healer: { id: 'heal-test', goal: 'g', inputKeys: ['product'] },
        inputs,
        budgets: config.budgets,
        settle: { sampleGapMs: 50, maxWaitMs: 500 },
        ladder: config.ladder,
        locators,
        runId,
        events: new EventLog(join(dir, `${runId}.jsonl`)),
        timings: new Timings(),
      });
      locators.save();
      return result;
    } finally {
      await browser.close();
    }
  }

  it('rung 3 is never offered the element the previous step just clicked, and is told what that step was', async () => {
    html = V2;
    const cartOpen: Step = { key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart ({n})', synonyms: [] } };
    const twoSteps = parsePlan({ ...plan, milestones: [{ key: 'cart', description: 'Add the product to the cart and open the cart.', completion: { kind: 'heading', text: 'Shoes' }, steps: [addStep, cartOpen] }] });
    const asked: Rung3Request[] = [];
    const picker: Rung3Picker = {
      async pick(_page, requests) {
        asked.push(...requests);
        // A careless picker: the first candidate whose name mentions the cart.
        return new Map(requests.map((request) => [request.expectation.stepKey, request.candidates.find((candidate) => /cart|bag/i.test(candidate.name)) ?? null]));
      },
    };
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await execute({
        page,
        origin,
        startUrl: `${origin}/`,
        plan: twoSteps,
        healer: { id: 'heal-test', goal: 'g', inputKeys: ['product'] },
        inputs,
        budgets: config.budgets,
        settle: { sampleGapMs: 50, maxWaitMs: 500 },
        ladder: config.ladder,
        locators: LocatorCache.load(dir, 'rung3-avoid'),
        picker,
        runId: 'rung3-avoid',
        events: new EventLog(join(dir, 'rung3-avoid.jsonl')),
        timings: new Timings(),
      });
    } finally {
      await browser.close();
    }
    const request = asked.find((candidate) => candidate.expectation.stepKey === 'cart.open');
    expect(request?.candidates.some((candidate) => candidate.name === 'Add to cart' && candidate.container?.name === 'Trail Runner')).toBe(false);
    expect(request?.purpose).toBe('click button "Cart ({n})", right after cart.add (click button "Add to cart" in article "{product}"); part of milestone cart: Add the product to the cart and open the cart.');
  }, 30_000);

  it('caches the first success, heals on rung 2 after a redesign, then resolves on rung 1', async () => {
    html = V1;
    expect(await runOnce('run-1')).toMatchObject({ outcome: 'completed', heals: [], rungHistogram: { '1': 1 } });
    const file = join(dir, 'runs', 'locators', 'heal-test.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).entries['cart.add']).toMatchObject({ rung: 1, updatedByRun: 'run-1', fingerprint: { landmark: { role: 'main' } } });

    html = V2;
    const healed = await runOnce('run-2');
    expect(healed.rungHistogram).toMatchObject({ '1': 0, '2': 1 });
    expect(healed.heals).toHaveLength(1);
    expect(healed.heals[0]).toMatchObject({ stepKey: 'cart.add', rung: 2, runId: 'run-2', to: { role: 'button', name: 'Add to cart', within: { role: 'article', name: 'Trail Runner' } } });
    expect(JSON.parse(readFileSync(file, 'utf8')).entries['cart.add']).toMatchObject({ rung: 2, updatedByRun: 'run-2', fingerprint: { landmark: { role: 'region' } } });

    const again = await runOnce('run-3');
    expect(again).toMatchObject({ heals: [], rungHistogram: { '1': 1 }, reusedHealsFrom: ['run-2'] });
  });
});

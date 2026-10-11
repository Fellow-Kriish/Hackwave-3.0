import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlan, type Plan } from '@hackwave/contracts';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { LlmAdapter, loadPrompt } from './llm';
import type { FetchLike } from './llm/providers';
import { resolveLlmSettings } from './llm/settings';
import { findRepoRoot } from './paths';
import { cacheablePlan } from './plan-cache';
import { createPlanner } from './planner';
import { namePattern } from './resolve';
import { pruneAriaSnapshot } from './tree';

const root = findRepoRoot();
const config = loadConfig(root);
const limits = { maxNodes: 400, maxTextChars: 80 };

describe('pruneAriaSnapshot', () => {
  const snapshot = [
    '- banner:',
    '  - link "Stride":',
    '    - /url: /',
    '  - navigation "Main":',
    '    - button "Cart (0)"',
    '- main:',
    '  - status: Trail Runner added to cart',
    '  - heading "Shoes for every step" [level=1]',
    '  - article "Trail Runner":',
    '    - heading "Trail Runner" [level=2]',
    '    - paragraph: ₹1,299',
    '    - button "Add to cart"',
    '  - textbox "Card number": "4242 4242 4242 4242"',
    '  - alert:',
    '    - heading "Please fix the following" [level=2]',
    '    - list:',
    '      - listitem: Enter your phone number',
    '  - group "Payment":',
    '    - text: Card',
    `  - button "${'x'.repeat(100)}"`,
  ].join('\n');

  it('keeps landmarks, interactive nodes, headings and named containers, nesting preserved', () => {
    const { text } = pruneAriaSnapshot(snapshot, limits);
    expect(text.split('\n')).toEqual([
      '- banner',
      '  - link "Stride"',
      '  - navigation "Main"',
      '    - button "Cart (0)"',
      '- main',
      '  - status: Trail Runner added to cart',
      '  - heading "Shoes for every step" [level=1]',
      '  - article "Trail Runner"',
      '    - heading "Trail Runner" [level=2]',
      '    - button "Add to cart"',
      '  - textbox "Card number" [filled]',
      '  - alert',
      '    - heading "Please fix the following" [level=2]',
      '    - listitem: Enter your phone number',
      '  - group "Payment"',
      `  - button "${'x'.repeat(79)}…"`,
    ]);
  });

  it('never shows a typed value to the model', () => {
    expect(pruneAriaSnapshot(snapshot, limits).text).not.toContain('4242');
  });

  it('refuses a tree over the node cap instead of truncating it', () => {
    expect(() => pruneAriaSnapshot(snapshot, { ...limits, maxNodes: 5 })).toThrow(/over the 5 limit/);
  });
});

describe('name templates', () => {
  it('lets {n} stand for a changing count and nothing else', () => {
    const pattern = namePattern('Cart ({n})');
    expect(pattern.test('Cart (0)')).toBe(true);
    expect(pattern.test('Cart (12)')).toBe(true);
    expect(pattern.test('Add to cart')).toBe(false);
    expect(pattern.test('Cart (1) extra')).toBe(false);
    expect(namePattern('Pay ₹1,299').test('Pay ₹1,299')).toBe(true);
  });
});

describe('plan cache', () => {
  it('keeps only steps whose milestone ran through', () => {
    const plan: Plan = parsePlan({
      intentId: 'i',
      goalHash: 'g',
      promptHash: 'p',
      createdAt: '2026-10-11T00:00:00.000Z',
      milestones: [
        { key: 'a', description: 'd', completion: { kind: 'filled' }, steps: [{ key: 'a.go', action: 'click', target: { role: 'button', name: 'A' } }] },
        { key: 'b', description: 'd', dependsOn: ['a'], completion: { kind: 'filled' }, steps: [{ key: 'b.go', action: 'click', target: { role: 'button', name: 'B' } }] },
      ],
    });
    const cached = cacheablePlan(plan, ['a', 'b'], ['a']);
    expect(cached.milestones.map((milestone) => milestone.steps.length)).toEqual([1, 0]);
  });
});

describe('planner against a real screen', () => {
  let browser: Browser;
  let page: Page;
  let cacheDir: string;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    cacheDir = mkdtempSync(join(tmpdir(), 'planner-test-'));
    page = await (await browser.newContext()).newPage();
    await page.setContent(`
      <header><nav aria-label="Main"><button>Cart (0)</button></nav></header>
      <main><h1>Shoes</h1>
        <article aria-labelledby="a"><h2 id="a">Trail Runner</h2><button>Add to cart</button></article>
        <article aria-labelledby="b"><h2 id="b">City Sneaker</h2><button>Add to cart</button></article>
      </main>`);
    return () => rmSync(cacheDir, { recursive: true, force: true });
  });

  function plannerWith(replies: string[]) {
    const sent: string[] = [];
    let index = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      sent.push(body.messages[1]?.content ?? '');
      const content = replies[Math.min(index++, replies.length - 1)] ?? '';
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    };
    const settings = resolveLlmSettings(config, { LLM_MODE: 'live', LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_MODEL_STRONG: 'm', LLM_MODEL_FAST: 'm' }, null);
    const llm = new LlmAdapter({ settings, config, cacheDir, maxCalls: 8, deadline: () => Date.now() + 60_000, fetchImpl });
    const planner = createPlanner({
      llm,
      prompts: { plan: loadPrompt(root, 'planner'), expand: loadPrompt(root, 'expand') },
      healer: { id: 'checkout-valid-card', goal: 'Buy the Trail Runner shoes.', inputKeys: ['card.number', 'product'] },
      inputValues: { product: 'Trail Runner', 'card.number': '4242 4242 4242 4242' },
      goalHash: 'g',
      tree: limits,
    });
    return { planner, sent };
  }

  const milestones = [
    { key: 'cart', description: 'Add the product and open the cart.', dependsOn: [], completion: { kind: 'heading', text: 'Cart' }, terminal: false },
    { key: 'place-order', description: 'Place the order.', dependsOn: ['cart'], completion: { kind: 'heading', text: 'Order confirmed' }, terminal: true },
  ];

  it('writes a milestone plan from the landing screen, without steps, and sends no values', async () => {
    const { planner, sent } = plannerWith([JSON.stringify({ milestones })]);
    const plan = await planner.plan(page);
    expect(plan.milestones.map((milestone) => [milestone.key, milestone.terminal, milestone.steps.length])).toEqual([
      ['cart', false, 0],
      ['place-order', true, 0],
    ]);
    expect(sent[0]).toContain('INPUT KEYS: card.number, product');
    expect(sent[0]).toContain('- button "Cart (0)"');
  });

  it('rejects a plan with no terminal milestone, then accepts the corrected one', async () => {
    const noTerminal = milestones.map((milestone) => ({ ...milestone, terminal: false }));
    const { planner, sent } = plannerWith([JSON.stringify({ milestones: noTerminal }), JSON.stringify({ milestones })]);
    expect((await planner.plan(page)).milestones.at(-1)?.terminal).toBe(true);
    expect(sent[1]).toContain('exactly one milestone must be terminal');
  });

  it('checks expanded steps against the live screen and asks again when a target is not there', async () => {
    const [cart, placeOrder] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!cart || !placeOrder) throw new Error('unreachable');
    const wrong = { milestones: [{ milestone: 'cart', steps: [{ key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart (1)' } }] }] };
    const right = {
      milestones: [
        {
          milestone: 'cart',
          steps: [
            { key: 'cart.add', action: 'click', target: { role: 'button', name: 'Add to cart', within: { role: 'article', nameRef: 'product' } } },
            { key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart ({n})' } },
          ],
        },
      ],
    };
    const { planner, sent } = plannerWith([JSON.stringify(wrong), JSON.stringify(right)]);
    const steps = await planner.expand(page, [cart, placeOrder], [], null);
    expect(steps.get('cart')?.steps.map((step) => step.key)).toEqual(['cart.add', 'cart.open']);
    expect(steps.get('cart')?.more).toBe(false);
    expect(steps.has('place-order')).toBe(false);
    expect(sent[1]).toContain('there is no button "Cart (1)" on this screen');
  });

  it('lets the last milestone continue on a later screen, and only the last', async () => {
    const [cart, placeOrder] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!cart || !placeOrder) throw new Error('unreachable');
    const step = { key: 'cart.open', action: 'click', target: { role: 'button', name: 'Cart ({n})' } };
    const moreTooEarly = { milestones: [{ milestone: 'cart', steps: [step], more: true }, { milestone: 'place-order', steps: [{ ...step, key: 'place-order.go' }] }] };
    const moreAtEnd = { milestones: [{ milestone: 'cart', steps: [step], more: true }] };
    const { planner, sent } = plannerWith([JSON.stringify(moreTooEarly), JSON.stringify(moreAtEnd)]);
    expect((await planner.expand(page, [cart, placeOrder], [], null)).get('cart')).toMatchObject({ more: true });
    expect(sent[1]).toContain('only the last milestone you return may have "more": true');
  });

  it('insists on nameRef when a scope is named after an input value', async () => {
    const [cart] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!cart) throw new Error('unreachable');
    const add = (within: Record<string, string>) => ({ milestones: [{ milestone: 'cart', steps: [{ key: 'cart.add', action: 'click', target: { role: 'button', name: 'Add to cart', within: { role: 'article', ...within } } }] }] });
    const { planner, sent } = plannerWith([JSON.stringify(add({ name: 'Trail Runner' })), JSON.stringify(add({ nameRef: 'product' }))]);
    const steps = await planner.expand(page, [cart], [], null);
    const step = steps.get('cart')?.steps[0];
    expect(step && 'target' in step ? step.target?.within : undefined).toEqual({ role: 'article', nameRef: 'product' });
    expect(sent[1]).toContain('is the value of input product; write "nameRef":"product"');
    expect(sent[0]).toContain('- article "Trail Runner" (= input product)');
    expect(sent[0]).toContain('- article "City Sneaker"\n');
    expect(sent.join('\n')).not.toContain('4242');
  });

  it('allows "more" only after a step that leaves the screen', async () => {
    await page.setContent('<main><label for="c">City</label><input id="c"><button>Continue</button></main>');
    const [cart] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!cart) throw new Error('unreachable');
    const fill = { key: 'cart.city', action: 'fill', target: { role: 'textbox', name: 'City' }, inputRef: 'card.number' };
    const afterFill = { milestones: [{ milestone: 'cart', steps: [fill], more: true }] };
    const afterClick = { milestones: [{ milestone: 'cart', steps: [fill, { key: 'cart.go', action: 'click', target: { role: 'button', name: 'Continue' } }], more: true }] };
    const { planner, sent } = plannerWith([JSON.stringify(afterFill), JSON.stringify(afterClick)]);
    expect((await planner.expand(page, [cart], [], null)).get('cart')?.more).toBe(true);
    expect(sent[1]).toContain('"more": true is only for a milestone whose last step leaves this screen');
  });

  it('closes a started milestone with no steps, but nothing else', async () => {
    const plan = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) });
    const [cart, placeOrder] = plan.milestones;
    if (!cart || !placeOrder) throw new Error('unreachable');
    const done = { key: 'cart.open', action: 'click' as const, target: { role: 'button', name: 'Cart ({n})', synonyms: [] } };
    cart.steps = [done];
    const close = { milestones: [{ milestone: 'cart', steps: [], more: false }] };
    const { planner } = plannerWith([JSON.stringify(close)]);
    expect((await planner.expand(page, [cart, placeOrder], [done], null)).get('cart')).toEqual({ steps: [], more: false });

    const emptyUnstarted = { milestones: [{ milestone: 'place-order', steps: [] }] };
    const { planner: strict } = plannerWith([JSON.stringify(emptyUnstarted)]);
    await expect(strict.expand(page, [placeOrder], [done], null)).rejects.toMatchObject({ code: 'llm_invalid_output' });
  });

  it('closes a milestone covered by a later one in the same reply, and never invents a step', async () => {
    const three = [
      { key: 'browse', description: 'Look around.', dependsOn: [], completion: { kind: 'filled' }, terminal: false },
      { key: 'cart', description: 'Add to cart.', dependsOn: ['browse'], completion: { kind: 'filled' }, terminal: false },
      { key: 'place-order', description: 'Place the order.', dependsOn: ['cart'], completion: { kind: 'heading', text: 'Done' }, terminal: true },
    ];
    const plan = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: three.map((m) => ({ ...m, steps: [] })) });
    const add = { key: 'cart.add', action: 'click', target: { role: 'button', name: 'Add to cart', within: { role: 'article', nameRef: 'product' } } };
    const covered = { milestones: [{ milestone: 'browse', steps: [] }, { milestone: 'cart', steps: [add] }] };
    const { planner } = plannerWith([JSON.stringify(covered)]);
    expect((await planner.expand(page, plan.milestones, [], null)).get('browse')).toEqual({ steps: [], more: false });

    const skipsAhead = { milestones: [{ milestone: 'browse', steps: [] }] };
    const { planner: strict, sent } = plannerWith([JSON.stringify(skipsAhead), JSON.stringify(skipsAhead)]);
    await expect(strict.expand(page, plan.milestones, [], null)).rejects.toMatchObject({ code: 'llm_invalid_output' });
    expect(sent[1]).toContain('only when a later milestone in this reply has steps');
  });

  it('keeps the committing click out of every milestone but the terminal one', async () => {
    await page.setContent('<main><label for="c">Card number</label><input id="c"><button>Place order</button></main>');
    const two = [
      { key: 'payment', description: 'Pay.', dependsOn: [], completion: { kind: 'filled' }, terminal: false },
      { key: 'place-order', description: 'Place it.', dependsOn: ['payment'], completion: { kind: 'heading', text: 'Done' }, terminal: true },
    ];
    const [payment, placeOrder] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: two.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!payment || !placeOrder) throw new Error('unreachable');
    const fill = { key: 'payment.number', action: 'fill', target: { role: 'textbox', name: 'Card number' }, inputRef: 'card.number' };
    const placeClick = { action: 'click', target: { role: 'button', name: 'Place order' } };
    const sneaky = { milestones: [{ milestone: 'payment', steps: [fill, { key: 'payment.go', ...placeClick }] }, { milestone: 'place-order', steps: [{ key: 'place-order.go', ...placeClick }] }] };
    const right = { milestones: [{ milestone: 'payment', steps: [fill] }, { milestone: 'place-order', steps: [{ key: 'place-order.go', ...placeClick }] }] };
    const { planner, sent } = plannerWith([JSON.stringify(sneaky), JSON.stringify(right)]);
    const steps = await planner.expand(page, [payment, placeOrder], [], null);
    expect(steps.get('payment')?.steps.map((step) => step.key)).toEqual(['payment.number']);
    expect(sent[1]).toContain('it belongs only to the terminal milestone');

    // Also when the terminal milestone was expanded earlier and only its committing step is known.
    const lateSneak = { milestones: [{ milestone: 'payment', steps: [fill, { key: 'payment.go', ...placeClick }] }] };
    const { planner: second } = plannerWith([JSON.stringify(lateSneak), JSON.stringify(lateSneak)]);
    const commit = { key: 'place-order.go', action: 'click' as const, target: { role: 'button', name: 'Place order', synonyms: [] } };
    await expect(second.expand(page, [payment], [], commit)).rejects.toMatchObject({ code: 'llm_invalid_output' });
  });

  it('rejects pressing Enter in a text field', async () => {
    await page.setContent('<main><label for="n">Full name</label><input id="n"><button>Place order</button></main>');
    const [, placeOrder] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!placeOrder) throw new Error('unreachable');
    const enter = { milestones: [{ milestone: 'place-order', steps: [{ key: 'place-order.go', action: 'press', target: { role: 'textbox', name: 'Full name' }, pressKey: 'Enter' }] }] };
    const click = { milestones: [{ milestone: 'place-order', steps: [{ key: 'place-order.go', action: 'click', target: { role: 'button', name: 'Place order' } }] }] };
    const { planner, sent } = plannerWith([JSON.stringify(enter), JSON.stringify(click)]);
    expect((await planner.expand(page, [placeOrder], [], null)).get('place-order')?.steps[0]?.action).toBe('click');
    expect(sent[1]).toContain('never press Enter in a text field');
  });

  it('refuses literal values and unknown input keys in expanded steps', async () => {
    const [cart] = parsePlan({ intentId: 'i', goalHash: 'g', promptHash: 'p', createdAt: '2026-10-11T00:00:00.000Z', milestones: milestones.map((m) => ({ ...m, steps: [] })) }).milestones;
    if (!cart) throw new Error('unreachable');
    const literal = { milestones: [{ milestone: 'cart', steps: [{ key: 'cart.add', action: 'fill', target: { role: 'button', name: 'Add to cart' }, value: '4000 0000 0000 0002' }] }] };
    const unknownKey = { milestones: [{ milestone: 'cart', steps: [{ key: 'cart.add', action: 'fill', target: { role: 'button', name: 'Add to cart' }, inputRef: 'card.upi' }] }] };
    const { planner } = plannerWith([JSON.stringify(literal), JSON.stringify(unknownKey)]);
    await expect(planner.expand(page, [cart], [], null)).rejects.toMatchObject({ code: 'llm_invalid_output' });
  });
});

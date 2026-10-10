import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContractError,
  flattenInputs,
  LocatorSpecSchema,
  parseIntent,
  parsePlan,
  planInputProblems,
  redactForHealer,
  sha256,
  type Plan,
} from './index';

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'));

const intent = parseIntent(readJson('intents/checkout.json'));
const planV1 = parsePlan(readJson('evals/plans/checkout.v1.json'));
const planV2 = parsePlan(readJson('evals/plans/checkout.v2.json'));

describe('intents', () => {
  it('parses the worked example from the build doc', () => {
    expect(intent.id).toBe('checkout-valid-card');
    expect(intent.oracle.state.match).toEqual({ items: ['Trail Runner'], total: 1299, cardLast4: '4242' });
    expect(parseIntent(readJson('intents/checkout-missing-product.json')).inputs.product).toBe('Moon Boot');
  });

  it('flattens grouped inputs into the keys plans reference', () => {
    expect(flattenInputs(intent.inputs)).toMatchObject({
      product: 'Trail Runner',
      'card.number': '4242 4242 4242 4242',
      'shipping.phone': '9876543210',
    });
  });

  it('explains what is wrong with a bad intent, field by field', () => {
    const broken = { ...intent, id: 'Has Spaces', oracle: { ...intent.oracle, ui: {} } };
    expect(() => parseIntent(broken)).toThrow(ContractError);
    expect(() => parseIntent(broken)).toThrow(/id[\s\S]*oracle\.ui/);
  });
});

describe('redactForHealer', () => {
  const healer = redactForHealer(intent);

  it('keeps only the id, the goal and the input keys', () => {
    expect(Object.keys(healer).sort()).toEqual(['goal', 'id', 'inputKeys']);
    expect(healer.inputKeys).toContain('card.number');
    expect(healer.inputKeys).toContain('shipping.phone');
  });

  it('leaks neither the oracle nor any input value', () => {
    const serialised = JSON.stringify(healer);
    for (const secret of ['oracle', 'orders', '1299', '4242', '9876543210', 'Indore', 'newRecordIdVisible']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(healer)).toBe(true);
    expect(Object.isFrozen(healer.inputKeys)).toBe(true);
  });
});

describe('plans', () => {
  it('parses both hand-written plans, tied to the checkout goal', () => {
    for (const plan of [planV1, planV2]) {
      expect(plan.goalHash).toBe(sha256(intent.goal));
      expect(plan.milestones.filter((milestone) => milestone.terminal).map((milestone) => milestone.key)).toEqual(['place-order']);
      expect(planInputProblems(plan, redactForHealer(intent).inputKeys)).toEqual([]);
    }
  });

  it('keeps step keys semantic and shared across v1 and v2', () => {
    const keys = (plan: Plan) => plan.milestones.flatMap((milestone) => milestone.steps.map((step) => step.key));
    const shared = keys(planV1).filter((key) => keys(planV2).includes(key));
    expect(shared).toEqual(expect.arrayContaining(['cart.add', 'cart.open', 'checkout.start', 'payment.number', 'place-order.submit']));
    expect(keys(planV2)).toContain('shipping.phone');
  });

  const withStep = (step: unknown) => ({
    ...planV1,
    milestones: [{ key: 'only', description: 'd', completion: { kind: 'filled' }, steps: [step] }],
  });

  it('rejects a literal value in a fill step', () => {
    const literal = { key: 'payment.number', action: 'fill', target: { role: 'textbox', name: 'Card number' }, value: '4000 0000 0000 0002' };
    expect(() => parsePlan(withStep(literal))).toThrow(ContractError);
  });

  it('requires exactly one of name and nameRef on a target', () => {
    const both = { key: 'cart.add', action: 'click', target: { role: 'button', name: 'Add', nameRef: 'product' } };
    const neither = { key: 'cart.add', action: 'click', target: { role: 'button' } };
    expect(() => parsePlan(withStep(both))).toThrow(/exactly one/);
    expect(() => parsePlan(withStep(neither))).toThrow(/exactly one/);
  });

  it('only allows Enter and Tab key presses', () => {
    expect(() => parsePlan(withStep({ key: 'form.submit', action: 'press', pressKey: 'Delete' }))).toThrow(ContractError);
    expect(() => parsePlan(withStep({ key: 'form.submit', action: 'press', pressKey: 'Enter' }))).not.toThrow();
  });

  it('rejects forward dependencies, duplicate keys and a second terminal milestone', () => {
    const [first, second] = planV1.milestones;
    expect(() => parsePlan({ ...planV1, milestones: [second, first] })).toThrow(/not listed above it/);
    expect(() => parsePlan({ ...planV1, milestones: [first, first] })).toThrow(/duplicate milestone/);
    const terminal = { ...planV1.milestones[4], key: 'pay-again', dependsOn: [] };
    expect(() => parsePlan({ ...planV1, milestones: [...planV1.milestones, terminal] })).toThrow(/at most one terminal/);
  });

  it('reports input keys the intent does not provide', () => {
    const plan = parsePlan(withStep({ key: 'payment.upi', action: 'fill', target: { role: 'textbox', name: 'UPI' }, inputRef: 'card.upi' }));
    expect(planInputProblems(plan, redactForHealer(intent).inputKeys)).toEqual([
      'payment.upi: inputRef "card.upi" is not an input of this intent',
    ]);
  });
});

describe('locators', () => {
  it('never allows nth without a scope', () => {
    expect(LocatorSpecSchema.safeParse({ role: 'button', name: 'Add to cart', nth: 1 }).success).toBe(false);
    expect(
      LocatorSpecSchema.safeParse({ role: 'button', name: 'Add to cart', nth: 0, within: { role: 'article', name: 'Trail Runner' } }).success,
    ).toBe(true);
  });
});

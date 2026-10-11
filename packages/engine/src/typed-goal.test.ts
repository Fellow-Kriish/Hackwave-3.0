import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactForHealer } from '@hackwave/contracts';
import { describe, expect, it } from 'vitest';
import { lintIntentText } from './intent-lint';
import { loadIntent } from './load';
import { findRepoRoot } from './paths';
import { fetchCatalog, typedIntent } from './typed-goal';

const root = findRepoRoot();
const testData = loadIntent(join(root, 'intents', 'checkout.json')).inputs;
const catalog = [
  { name: 'Trail Runner', price: 1299 },
  { name: 'City Sneaker', price: 1499 },
];

describe('a goal typed in plain words', () => {
  it('builds a test around it, with a success check written by code', () => {
    const { intent, notes } = typedIntent('Complete checkout with a valid credit card', testData, catalog);
    expect(intent.id).toBe('typed-complete-checkout-valid-credit-card');
    expect(intent.goal).toBe('Complete checkout with a valid credit card');
    expect(intent.oracle.state).toEqual({ store: 'orders', expectedNewCount: 1, match: { items: ['Trail Runner'], total: 1299, cardLast4: '4242' } });
    expect(notes[0]).toBe("product: Trail Runner (the goal names none the shop sells, so the test data's)");
    expect(lintIntentText(JSON.stringify(intent)).problems).toEqual([]);
  });

  it('checks the product the goal names, at its catalogue price', () => {
    const { intent, notes } = typedIntent('Buy the city sneaker and pay with a credit card', testData, catalog);
    expect(intent.inputs.product).toBe('City Sneaker');
    expect(intent.oracle.state.match).toEqual({ items: ['City Sneaker'], total: 1499, cardLast4: '4242' });
    expect(notes[0]).toBe('product: City Sneaker (named in the goal)');
  });

  it('never shows the success check to the healer', () => {
    const { intent } = typedIntent('Complete checkout with a valid credit card', testData, catalog);
    expect(JSON.stringify(redactForHealer(intent))).not.toContain('orders');
  });

  it('reads the catalogue from the app, and copes when there is none', async () => {
    const products = JSON.stringify([{ id: 'x', name: 'Trail Runner', price: 1299, description: 'd' }]);
    expect(await fetchCatalog('http://shop', async () => new Response(products))).toEqual([{ name: 'Trail Runner', price: 1299 }]);
    expect(await fetchCatalog('http://shop', async () => new Response('nope', { status: 404 }))).toEqual([]);
    expect(
      await fetchCatalog('http://shop', async () => {
        throw new Error('down');
      }),
    ).toEqual([]);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('runs/plans/typed-*.json');
  });
});

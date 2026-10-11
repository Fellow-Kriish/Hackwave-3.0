import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import type { Fingerprint } from './fingerprint';
import { similarityScore } from './ladder';
import type { LocatorCacheEntry } from './locator-cache';

/**
 * Rung 2's thresholds are not hand-picked: they must separate these labelled pairs. "match" pairs are the same
 * control after a harmless change, which rung 2 should heal on its own; "different" pairs are a real rename or
 * another control, which must go to rung 3 (or nowhere). Add a pair whenever a heal surprises you.
 */
const fp = (name: string, landmark: string | null, siblingText: string[] = []): Fingerprint => ({
  role: 'button',
  name,
  landmark: landmark ? { role: landmark, name: null } : null,
  siblingText,
  href: null,
  type: null,
});

const cached = (fingerprint: Fingerprint): LocatorCacheEntry => ({
  locator: { role: 'button', name: fingerprint.name },
  fingerprint,
  rung: 1,
  updatedByRun: 'calibration',
  updatedAt: '2026-10-11T00:00:00.000Z',
});

interface Pair {
  label: string;
  names: string[];
  before?: Fingerprint;
  candidate: Fingerprint;
  match: boolean;
}

const PAIRS: Pair[] = [
  { label: 'cart count changed', names: ['Cart ({n})'], before: fp('Cart (1)', 'navigation'), candidate: fp('Cart (3)', 'navigation'), match: true },
  { label: 'no cache, count changed', names: ['Cart ({n})'], candidate: fp('Cart (2)', 'navigation'), match: true },
  { label: 'capitalisation changed', names: ['Add to cart'], before: fp('Add to cart', 'main', ['Trail Runner']), candidate: fp('Add to Cart', 'main', ['Trail Runner']), match: true },
  { label: 'same button, moved landmark', names: ['Add to cart'], before: fp('Add to cart', 'main', ['Trail Runner']), candidate: fp('Add to cart', 'region', ['Trail Runner']), match: true },
  { label: 'price changed', names: ['Pay ₹1,299'], before: fp('Pay ₹1,299', 'form', ['Payment']), candidate: fp('Pay ₹999', 'form', ['Payment']), match: true },
  { label: 'synonym without the price', names: ['Place order', 'Pay'], before: fp('Place order', 'form', ['Payment']), candidate: fp('Pay ₹1,299', 'form', ['Payment']), match: true },
  { label: 'synonym without the count', names: ['Cart (1)', 'Cart'], candidate: fp('Cart (4)', 'navigation'), match: true },
  { label: 'punctuation added', names: ['Continue to payment'], before: fp('Continue to payment', 'form'), candidate: fp('Continue to payment →', 'form'), match: true },
  { label: 'synonym in other case', names: ['Checkout', 'Proceed to checkout'], candidate: fp('Proceed to Checkout', 'main'), match: true },

  { label: 'real rename: checkout', names: ['Checkout'], before: fp('Checkout', 'main'), candidate: fp('Proceed to payment', 'main'), match: false },
  { label: 'real rename: place order', names: ['Place order'], before: fp('Place order', 'form', ['Payment']), candidate: fp('Pay ₹1,299', 'form', ['Payment']), match: false },
  { label: 'real rename: bag', names: ['Cart ({n})'], before: fp('Cart (1)', 'navigation'), candidate: fp('Your bag', 'navigation'), match: false },
  { label: 'another control: add vs cart', names: ['Cart ({n})'], before: fp('Cart (1)', 'navigation'), candidate: fp('Add to cart', 'main', ['Trail Runner']), match: false },
  { label: 'another size', names: ['Size 9'], before: fp('Size 9', 'main', ['Sizes']), candidate: fp('Size 10', 'main', ['Sizes']), match: false },
  { label: 'another model number', names: ['Air Max 90'], candidate: fp('Air Max 95', 'main'), match: false },
  { label: 'another field, same form', names: ['Card number'], before: fp('Card number', 'form', ['Payment']), candidate: fp('Name on card', 'form', ['Payment']), match: false },
  { label: 'another field: names', names: ['Full name'], before: fp('Full name', 'form', ['Shipping']), candidate: fp('Name on card', 'form', ['Payment']), match: false },
];

describe('rung-2 calibration', () => {
  const { similarityAccept } = loadConfig().ladder;
  const scored = PAIRS.map((pair) => ({ ...pair, score: similarityScore(pair.candidate, { names: pair.names, cached: pair.before ? cached(pair.before) : null }) }));

  it.each(scored.filter((pair) => pair.match))('heals on its own: $label ($score)', ({ score }) => {
    expect(score).toBeGreaterThanOrEqual(similarityAccept);
  });

  it.each(scored.filter((pair) => !pair.match))('leaves to rung 3: $label ($score)', ({ score }) => {
    expect(score).toBeLessThan(similarityAccept);
  });

  it('keeps the accept threshold inside the window the labels allow, with room on both sides', () => {
    const lowestMatch = Math.min(...scored.filter((pair) => pair.match).map((pair) => pair.score));
    const highestDifferent = Math.max(...scored.filter((pair) => !pair.match).map((pair) => pair.score));
    expect(highestDifferent).toBeLessThan(similarityAccept);
    expect(lowestMatch).toBeGreaterThanOrEqual(similarityAccept);
    // A threshold within 0.02 of either side is a knife edge: one more pair would flip it.
    expect(similarityAccept - highestDifferent).toBeGreaterThanOrEqual(0.02);
    expect(lowestMatch - similarityAccept).toBeGreaterThanOrEqual(0.02);
  });
});

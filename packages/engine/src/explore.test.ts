import { redactForHealer } from '@hackwave/contracts';
import { describe, expect, it } from 'vitest';
import { exploreIntent, parseInputs, renderExploreReport, type ExploreResult } from './explore';
import { pruneAriaSnapshot } from './tree';

const bigPage = [
  '- banner:',
  '  - combobox "Select the department" :',
  '    - option "All Categories" [selected]',
  ...Array.from({ length: 50 }, (_, i) => `    - option "Department ${i}"`),
  '  - searchbox "Search"',
  '  - button "Go"',
  ...Array.from({ length: 300 }, (_, i) => `- link "Result ${i}"`),
].join('\n');

describe('explore mode', () => {
  it('trims an oversized page to its top instead of refusing it, and hides a closed dropdown', () => {
    const tree = pruneAriaSnapshot(bigPage, { maxNodes: 50, maxTextChars: 60, overflow: 'trim' });
    const lines = tree.text.split('\n');
    expect(lines).toHaveLength(50);
    expect(tree.text).toContain('option "All Categories" [selected]');
    expect(tree.text).not.toContain('Department 0');
    expect(tree.text).toContain('searchbox "Search"');
    expect(lines.at(-1)).toBe('- note "showing the top 49 of 305 elements; the rest of the page is not shown"');
  });

  it('leaves tests as they were: an oversized page is still refused, options and all', () => {
    expect(() => pruneAriaSnapshot(bigPage, { maxNodes: 50, maxTextChars: 60 })).toThrow(/over the 50 limit; refusing to send it/);
    expect(pruneAriaSnapshot(bigPage, { maxNodes: 1000, maxTextChars: 60 }).text).toContain('Department 49');
  });

  it('builds the goal as an intent with the words it may type, and the AI never sees their values', () => {
    const intent = exploreIntent('search for the query and add the first result to the cart', parseInputs(['query=water bottle']));
    expect(intent.id).toBe('explore-search-query-add-first-result');
    expect(intent.inputs).toEqual({ query: 'water bottle' });
    expect(intent.budgets).toEqual({ runMs: 180_000, stepMs: 20_000 });
    expect(JSON.stringify(redactForHealer(intent))).not.toContain('water bottle');
    expect(() => parseInputs(['Query=x'])).toThrow(/lowerCamelCase/);
    expect(() => parseInputs(['no-equals'])).toThrow(/key=value/);
  });

  it('reports UNVERIFIED, never a pass, with its screenshots', () => {
    const result: ExploreResult = {
      runDir: 'runs/x',
      outcome: 'completed',
      reason: null,
      healerBelievedDone: { believed: true, atStep: 3, stepKey: 'add-to-cart.add' },
      actions: 3,
      milestones: ['search', 'add-to-cart'],
      finalUrl: 'https://shop.example/cart',
      finalTitle: 'Cart',
      finalHeading: 'Added to cart',
      llmCalls: 4,
      screenshot: 'final.png',
      shots: [{ file: 'shots/01-add-to-cart.add.png', kind: 'healed', stepKey: 'add-to-cart.add', caption: 'Found button "Add to Cart" instead of button "Add to basket" (rung 3)' }],
    };
    const report = renderExploreReport('add one item to cart', 'https://shop.example/', null, result);
    expect(report.startsWith('# UNVERIFIED · explore mode')).toBe(true);
    expect(report).toContain('it is never a pass');
    expect(report).toContain('![Found button "Add to Cart" instead of button "Add to basket" (rung 3)](shots/01-add-to-cart.add.png)');
    expect(report).not.toMatch(/GREEN|PASSED/);
  });
});

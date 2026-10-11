import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocatorCache, locatorCacheFile, type LocatorCacheEntry } from './locator-cache';

const entry = (name: string, updatedByRun = 'run-a'): LocatorCacheEntry => ({
  locator: { role: 'button', name },
  fingerprint: { role: 'button', name, landmark: { role: 'main', name: null }, siblingText: [], href: null, type: null },
  rung: 1,
  updatedByRun,
  updatedAt: '2026-10-11T00:00:00.000Z',
});

describe('locator cache', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'locators-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps hand-plan locators in a separate file', () => {
    expect(locatorCacheFile(root, 'i')).toBe(join(root, 'runs', 'locators', 'i.json'));
    expect(locatorCacheFile(root, 'i', true)).toBe(join(root, 'runs', 'locators', 'i.hand.json'));
  });

  it('writes only when something changed, with entries sorted by step key', () => {
    const cache = LocatorCache.load(root, 'i');
    expect(cache.save()).toBe(false);
    cache.set('shipping.name', entry('Full name'));
    cache.set('cart.add', entry('Add to cart'));
    expect(cache.updatedKeys()).toEqual(['shipping.name', 'cart.add']);
    expect(cache.save()).toBe(true);
    const text = readFileSync(locatorCacheFile(root, 'i'), 'utf8');
    expect(Object.keys((JSON.parse(text) as { entries: object }).entries)).toEqual(['cart.add', 'shipping.name']);

    const again = LocatorCache.load(root, 'i');
    expect(again.problem).toBeNull();
    expect(again.get('cart.add')).toEqual(entry('Add to cart'));
    expect(again.save()).toBe(false);
  });

  it('ignores a file that is invalid or belongs to another intent, and says why', () => {
    mkdirSync(join(root, 'runs', 'locators'), { recursive: true });
    writeFileSync(locatorCacheFile(root, 'i'), JSON.stringify({ intentId: 'i', entries: { 'cart.add': { locator: { role: 'button' } } } }));
    const invalid = LocatorCache.load(root, 'i');
    expect(invalid.get('cart.add')).toBeUndefined();
    expect(invalid.problem).toMatch(/^the file is invalid/);

    writeFileSync(locatorCacheFile(root, 'i'), JSON.stringify({ intentId: 'other', entries: {} }));
    expect(LocatorCache.load(root, 'i').problem).toBe('the file belongs to other');
  });
});

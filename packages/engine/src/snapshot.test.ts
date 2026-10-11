import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTS, WRONG_TOTAL_ACT } from './demo';
import { markdownToHtml } from './html';
import { captureCaches, listSnapshots, putBackCaches, restoreSnapshot, saveSnapshot } from './snapshot';

describe('snapshots of the plan and locator caches', () => {
  let root: string;
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'snapshot-test-'));
    write('runs/plans/checkout.json', 'plan v1');
    write('runs/locators/checkout.json', 'locators v1');
    write('runs/locators/checkout.hand.json', 'scratch');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saves the committed caches (never the hand-plan scratch cache) and restores them exactly', () => {
    expect(saveSnapshot(root, 'post-act-1')).toEqual(['plans/checkout.json', 'locators/checkout.json']);
    expect(existsSync(join(root, 'runs/snapshots/post-act-1/locators/checkout.hand.json'))).toBe(false);
    expect(listSnapshots(root)).toEqual(['post-act-1']);

    write('runs/plans/checkout.json', 'plan healed on v2');
    write('runs/plans/extra.json', 'a plan written later');
    write('runs/locators/checkout.json', 'locators healed on v2');
    expect(restoreSnapshot(root, 'post-act-1')).toEqual(['plans/checkout.json', 'locators/checkout.json']);
    expect(read('runs/plans/checkout.json')).toBe('plan v1');
    expect(read('runs/locators/checkout.json')).toBe('locators v1');
    expect(existsSync(join(root, 'runs/plans/extra.json'))).toBe(false);
    expect(read('runs/locators/checkout.hand.json')).toBe('scratch');
  });

  it('refuses a missing snapshot and a bad name', () => {
    expect(() => restoreSnapshot(root, 'post-act-2')).toThrow('there is no snapshot "post-act-2"');
    expect(() => saveSnapshot(root, '../outside')).toThrow('is not a snapshot name');
  });

  it('puts the caches back as captured, removing files added since', () => {
    const before = captureCaches(root);
    write('runs/locators/checkout.json', 'changed');
    write('runs/plans/new.json', 'new');
    putBackCaches(root, before);
    expect(read('runs/locators/checkout.json')).toBe('locators v1');
    expect(existsSync(join(root, 'runs/plans/new.json'))).toBe(false);
  });
});

describe('the demo script', () => {
  it('runs the four acts of docs/BUILD.md in order, with the reserve bug as an optional fifth', () => {
    expect(ACTS.map((act) => [act.act, act.target, act.expect.color])).toEqual([
      [1, 'v1', 'GREEN'],
      [2, 'v2', 'AMBER'],
      [3, 'v2-broken', 'RED'],
      [4, 'v2', 'GREEN'],
    ]);
    expect(ACTS[3]?.expect.maxLlmCalls).toBe(0);
    expect(WRONG_TOTAL_ACT).toMatchObject({ act: 5, target: 'v2-wrong-total', expect: { color: 'RED', kind: 'real_bug' } });
  });

  it('links each act in the fallback page, and never turns a script URL into a link', () => {
    const html = markdownToHtml('| Report |\n| --- |\n| [report.html](../run-1/report.html) |\n\nbad [x](javascript:alert(1))', 'Demo');
    expect(html).toContain('<a href="../run-1/report.html">report.html</a>');
    expect(html).not.toContain('href="javascript');
  });
});

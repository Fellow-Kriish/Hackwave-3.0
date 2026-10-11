import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRepoRoot } from '../paths';
import { GUIDED_STEPS, knownIntentFor, parseBatch, resolveRunFile, startUiServer, type UiServer } from './server';

const root = findRepoRoot();

describe('files the web app serves', () => {
  const runs = mkdtempSync(join(tmpdir(), 'hw-ui-runs-'));
  mkdirSync(join(runs, 'run-1'));
  writeFileSync(join(runs, 'run-1', 'report.html'), '<p>report</p>');
  writeFileSync(join(runs, '..', 'hw-ui-secret.txt'), 'secret');
  afterAll(() => {
    rmSync(runs, { recursive: true, force: true });
    rmSync(join(runs, '..', 'hw-ui-secret.txt'), { force: true });
  });

  it('serves a run report and nothing outside runs/', () => {
    expect(resolveRunFile(runs, '/runs/run-1/report.html')).toBe(join(runs, 'run-1', 'report.html'));
    expect(resolveRunFile(runs, '/runs/../hw-ui-secret.txt')).toBeNull();
    expect(resolveRunFile(runs, '/runs/..%2Fhw-ui-secret.txt')).toBeNull();
    expect(resolveRunFile(runs, '/runs/..%5Chw-ui-secret.txt')).toBeNull();
    expect(resolveRunFile(runs, `/runs/${encodeURIComponent(join(runs, '..', 'hw-ui-secret.txt'))}`)).toBeNull();
    expect(resolveRunFile(runs, '/runs/run-1')).toBeNull();
    expect(resolveRunFile(runs, '/runs/%E0%A4%A')).toBeNull();
    expect(resolveRunFile(runs, '/runs/run-1/missing.html')).toBeNull();
  });
});

describe('goals with recorded answers', () => {
  it('knows the checkout goal however it is typed, and nothing else', () => {
    const goal = 'As a shopper, buy the Trail Runner shoes with a valid credit card and reach order confirmation.';
    expect(knownIntentFor(root, goal)?.id).toBe('checkout-valid-card');
    expect(knownIntentFor(root, `  ${goal.toUpperCase().replace(/\.$/, '')}  `)?.id).toBe('checkout-valid-card');
    expect(knownIntentFor(root, 'Complete checkout with a valid credit card')).toBeNull();
  });

  it('runs the guided demo as the stage script does: A from scratch, then B, B broken, B again', () => {
    expect(GUIDED_STEPS.map((step) => `${step.version}${step.fresh ? ' fresh' : ''}`)).toEqual(['v1 fresh', 'v2', 'v2-broken', 'v2']);
  });
});

describe('what a test request becomes', () => {
  const goal = 'Complete checkout with a valid credit card';

  it('runs the picked versions in order, forgetting what was learned only before the first', () => {
    const batch = parseBatch({ project: 'shop', goal, versions: ['v1', 'v2', 'v2-broken'], fresh: true }, false);
    expect(typeof batch === 'string' ? batch : batch.runs.map((run) => `${run.code}${run.fresh ? ' fresh' : ''}`)).toEqual(['A fresh', 'B', 'B1']);
    expect(parseBatch({ project: 'shop', goal, versions: [] }, false)).toBe('pick at least one version');
    expect(parseBatch({ project: 'shop', goal, versions: ['v9'] }, false)).toBe('unknown version "v9"');
  });

  it('turns the guided demo into a preset batch, whatever versions were ticked', () => {
    const batch = parseBatch({ project: 'shop', goal, versions: ['v2-wrong-total'] }, true);
    expect(typeof batch === 'string' ? batch : batch.runs.map((run) => run.code)).toEqual(['A', 'B', 'B1', 'B']);
  });

  it('explores a website only at an http or https address, with optional words to type', () => {
    const batch = parseBatch({ project: 'website', goal, url: 'https://www.example.com/', query: '  water   bottle ' }, false);
    expect(batch).toMatchObject({ project: 'website', url: 'https://www.example.com/', query: 'water bottle', runs: [{ code: 'W', name: 'www.example.com' }] });
    expect(parseBatch({ project: 'website', goal, url: 'not a url' }, false)).toBe('give the website address, e.g. https://www.example.com');
    expect(parseBatch({ project: 'website', goal, url: 'file:///etc/passwd' }, false)).toBe('the website address must start with http:// or https://');
  });
});

describe('the web app server', () => {
  let server: UiServer;
  beforeAll(async () => {
    server = await startUiServer({ port: 0, headed: false, slowMo: 0 });
  });
  afterAll(async () => {
    await server?.close();
  });

  it('serves the page and its state', async () => {
    const page = await fetch(server.url);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Goal, in plain words');
    const state = (await (await fetch(`${server.url}/api/state`)).json()) as { defaultGoal: string; address: string; busy: boolean; deployed: unknown };
    expect(state.defaultGoal).toBe(knownIntentFor(root, state.defaultGoal)?.goal);
    expect(state.address).toMatch(/^http:\/\/localhost:\d+$/);
    expect(state).toMatchObject({ busy: false, deployed: null });
  });

  it('refuses work it should not do, before any shop or browser starts', async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${server.url}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    expect((await post({ goal: 'Complete checkout with a valid credit card' }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await fetch(`${server.url}/api/run`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'goal=x' })).status).toBe(403);
    expect((await post({ goal: 'too short' })).status).toBe(400);
    expect((await post({ goal: 'Complete checkout with a valid credit card', version: 'v9' })).status).toBe(400);
    expect((await fetch(`${server.url}/runs/..%2F.env`)).status).toBe(404);
    expect((await fetch(`${server.url}/api/state`).then((response) => response.json())) as { deployed: unknown }).toMatchObject({ deployed: null });
  });
});

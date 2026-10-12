import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyRungHistogram, parseIntent, type RunRecord } from '@hackwave/contracts';
import { ESLint } from 'eslint';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baselineOf, checkAlerts, checkBinding, checkStateDelta, normalise } from './checks';
import type { StoreAdapter, StoreRecord } from './store';
import { createVerifier } from './verify';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const realIntent = parseIntent(JSON.parse(readFileSync(join(ROOT, 'intents/checkout.json'), 'utf8')));
// The real intent polls for 5 s (oracle.state.pollMs wins over the default); tests poll briefly.
const intent = { ...realIntent, oracle: { ...realIntent.oracle, state: { ...realIntent.oracle.state, pollMs: 250 } } };
const match = intent.oracle.state.match;

const order = (id: number, overrides: Partial<StoreRecord> = {}): StoreRecord => ({
  id,
  items: [{ productId: 'trail-runner', name: 'Trail Runner', qty: 1, unitPrice: 1299 }],
  total: 1299,
  cardLast4: '4242',
  ...overrides,
});

/** A store whose listing changes over successive calls, like a backend that persists a moment late. */
function fakeStore(listings: StoreRecord[][], options: { getMissing?: boolean; failAfter?: number } = {}): StoreAdapter {
  let calls = 0;
  return {
    name: 'orders',
    url: 'http://test/api/orders',
    async list() {
      calls++;
      if (options.failAfter !== undefined && calls > options.failAfter) throw new Error('fetch failed');
      return structuredClone(listings[Math.min(calls - 1, listings.length - 1)] ?? []);
    },
    async get(id) {
      if (options.getMissing) return null;
      return listings.flat().find((record) => record.id === id) ?? null;
    },
  };
}

const quick = { expectedNewCount: 1, match, pollMs: 300, intervalMs: 20 };

describe('state delta', () => {
  it('passes when exactly one matching record appears, even after a delay', async () => {
    const store = fakeStore([[order(4820)], [order(4820)], [order(4820), order(4821)]]);
    const { result, record } = await checkStateDelta({ store, baseline: baselineOf([order(4820)]), ...quick });
    expect(result.status).toBe('pass');
    expect(record?.id).toBe(4821);
    expect(result.summary).toBe('1 new record 4821 in orders; items [Trail Runner], total 1299, cardLast4 4242 match');
  });

  it('fails with zero new records after waiting the poll window', async () => {
    const started = Date.now();
    const { result } = await checkStateDelta({ store: fakeStore([[]]), baseline: baselineOf([]), ...quick });
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/expected 1 new record\(s\) in orders, found 0 after waiting 300 ms/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });

  it('fails at once on a duplicate order', async () => {
    const { result } = await checkStateDelta({ store: fakeStore([[order(4821), order(4822)]]), baseline: baselineOf([]), ...quick });
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/found 2/);
  });

  it('names both values on a wrong total', async () => {
    const wrong = order(4821, { total: 999 });
    const { result } = await checkStateDelta({ store: fakeStore([[wrong]]), baseline: baselineOf([]), ...quick });
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('4821.total 999 ≠ expected 1299');
  });

  it('fails when the record is listed but cannot be read back by id', async () => {
    const { result } = await checkStateDelta({ store: fakeStore([[order(4821)]], { getMissing: true }), baseline: baselineOf([]), ...quick });
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('readBack not found (404)');
  });

  it('reports an unreachable store as an error, not a failure', async () => {
    const { result } = await checkStateDelta({ store: fakeStore([[]], { failAfter: 0 }), baseline: baselineOf([]), ...quick });
    expect(result.status).toBe('error');
    expect(result.summary).toContain('fetch failed');
  });
});

describe('binding and alerts', () => {
  it('normalises ids and page text alike', () => {
    expect(normalise('Thanks! Order ORD-4821 is on its way')).toBe('thanksorderord4821isonitsway');
    expect(checkBinding(4821, 'Thanks! Order ORD-4821 is on its way').status).toBe('pass');
    expect(checkBinding(4821, 'Order confirmed #4821').status).toBe('pass');
    expect(checkBinding(4821, 'Order confirmed #4822').status).toBe('fail');
  });

  it('treats any role=alert with text as an error state', () => {
    expect(checkAlerts([]).status).toBe('pass');
    expect(checkAlerts(['  ']).status).toBe('pass');
    expect(checkAlerts(["We couldn't place your order\nFailed to fetch"]).summary).toContain("We couldn't place your order Failed to fetch");
  });
});

describe('createVerifier against a real page', () => {
  let browser: Browser;
  let page: Page;
  let evidenceDir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    evidenceDir = mkdtempSync(join(tmpdir(), 'verifier-test-'));
    page = await (await browser.newContext()).newPage();
    return () => rmSync(evidenceDir, { recursive: true, force: true });
  });

  const record = (overrides: Partial<RunRecord> = {}): RunRecord => ({
    runId: 'r',
    intentId: intent.id,
    target: 'http://localhost:5173/',
    startedAt: '2026-10-11T00:00:00.000Z',
    endedAt: '2026-10-11T00:00:05.000Z',
    outcome: 'completed',
    reason: null,
    terminalAttempted: true,
    healerBelievedDone: { believed: true, atStep: 14, stepKey: 'place-order.submit' },
    actions: 14,
    lastStepKey: 'place-order.submit',
    heals: [],
    replans: [],
    rungHistogram: emptyRungHistogram(),
    llmCalls: { total: 0, cached: 0, byModel: {} },
    tokens: { input: 0, output: 0, byModel: {} },
    timings: { browserMs: 0, llmMs: 0, totalMs: 0, steps: [] },
    environmentErrors: [],
    ...overrides,
  });

  it('catches a confirmation page with nothing behind it (v2-broken)', async () => {
    await page.setContent('<main><h1>Thanks! Order ORD-4821 is on its way</h1></main>');
    const verifier = createVerifier(intent, { origin: 'http://test', evidenceDir, defaultPollMs: 300, pollIntervalMs: 20, store: fakeStore([[]]) });
    await verifier.baseline();
    const result = await verifier.verify(page, record());
    expect(result.state.status).toBe('fail');
    expect(result.binding.status).toBe('skipped');
    expect(result.finalHeading).toBe('Thanks! Order ORD-4821 is on its way');
    for (const file of ['baseline.json', 'store-after.json', 'oracle.json', 'final.png', 'final-aria.yml', 'final-url.txt']) {
      expect(existsSync(join(evidenceDir, file)), file).toBe(true);
    }
  });

  it('passes a saved, confirmed order with no alerts', async () => {
    await page.setContent('<main><h1>Order confirmed #4821</h1><p role="status"></p></main>');
    const verifier = createVerifier(intent, {
      origin: 'http://test',
      evidenceDir,
      defaultPollMs: 300,
      pollIntervalMs: 20,
      store: fakeStore([[], [order(4821)]]),
    });
    await verifier.baseline();
    const result = await verifier.verify(page, record());
    expect([result.state.status, result.binding.status, result.alerts.status]).toEqual(['pass', 'pass', 'pass']);
    expect(result.newRecordId).toBe(4821);
  });

  it('waits for a confirmation that arrives a moment after the save (the app navigates once its request returns)', async () => {
    await page.setContent('<main><h1>Checkout</h1><button disabled>Place order</button></main>');
    await page.evaluate("setTimeout(() => { document.body.innerHTML = '<main><h1>Order confirmed #4821</h1></main>'; }, 600)");
    const verifier = createVerifier(intent, { origin: 'http://test', evidenceDir, defaultPollMs: 300, pollIntervalMs: 20, store: fakeStore([[], [order(4821)]]) });
    await verifier.baseline();
    const result = await verifier.verify(page, record());
    expect([result.state.status, result.binding.status]).toEqual(['pass', 'pass']);
    expect(result.finalHeading).toBe('Order confirmed #4821');
  });

  it('quotes the confirmation a one-page app shows, not its hero heading (narration only)', async () => {
    await page.setContent('<main><h1>Good things. Better finds.</h1><div role="dialog" aria-modal="true"><p>ORDER CONFIRMED</p><h2>Nice choice.</h2><p>Order #1001 is confirmed for Kartik Test.</p></div></main>');
    const verifier = createVerifier(intent, { origin: 'http://test', evidenceDir, defaultPollMs: 200, pollIntervalMs: 20, bindingWaitMs: 200, store: fakeStore([[]]) });
    await verifier.baseline();
    const result = await verifier.verify(page, record());
    expect(result.finalHeading).toBe('Order #1001 is confirmed for Kartik Test.');
    expect(result.state.status).toBe('fail');
  });

  it('catches an order saved but never confirmed to the user', async () => {
    await page.setContent('<main><h1>Checkout</h1><div role="alert">Something went wrong</div></main>');
    const verifier = createVerifier(intent, { origin: 'http://test', evidenceDir, defaultPollMs: 300, pollIntervalMs: 20, bindingWaitMs: 400, store: fakeStore([[], [order(4821)]]) });
    await verifier.baseline();
    const result = await verifier.verify(page, record({ healerBelievedDone: { believed: false, atStep: 12, stepKey: 'place-order.submit' } }));
    expect(result.state.status).toBe('pass');
    expect(result.binding.status).toBe('fail');
    expect(result.alerts.status).toBe('fail');
  });

  it('does not judge page checks when the store is down', async () => {
    await page.setContent('<main><div role="alert">Failed to fetch</div></main>');
    const verifier = createVerifier(intent, {
      origin: 'http://test',
      evidenceDir,
      defaultPollMs: 200,
      pollIntervalMs: 20,
      store: fakeStore([[]], { failAfter: 1 }),
    });
    await verifier.baseline();
    const result = await verifier.verify(page, record());
    expect([result.state.status, result.binding.status, result.alerts.status]).toEqual(['error', 'skipped', 'skipped']);
  });

  it('takes the poll window from the oracle, not the default', async () => {
    await page.setContent('<main><h1>Thanks!</h1></main>');
    const verifier = createVerifier(intent, { origin: 'http://test', evidenceDir, defaultPollMs: 60_000, pollIntervalMs: 20, store: fakeStore([[]]) });
    await verifier.baseline();
    const started = Date.now();
    expect((await verifier.verify(page, record())).state.summary).toMatch(/after waiting 250 ms/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('evaluates nothing when the terminal action was never attempted', async () => {
    const verifier = createVerifier(intent, { origin: 'http://test', evidenceDir, defaultPollMs: 200, store: fakeStore([[]]) });
    await verifier.baseline();
    const result = await verifier.verify(page, record({ outcome: 'unresolvable', terminalAttempted: false }));
    expect(result.evaluated).toBe(false);
    expect(result.state.status).toBe('skipped');
  });
});

// Starting ESLint and its TypeScript parser takes a few seconds, more on a busy machine.
describe('lint boundary', { timeout: 30_000 }, () => {
  const eslint = new ESLint({ cwd: ROOT });
  const lint = async (code: string, file = 'packages/verifier/src/probe.ts') =>
    (await eslint.lintText(code, { filePath: join(ROOT, file) }))[0]?.messages.map((entry) => entry.ruleId) ?? [];

  it('fails the build when the verifier imports the engine or an LLM module', async () => {
    expect(await lint("import { x } from '@hackwave/engine';\nexport const y = x;\n")).toContain('@typescript-eslint/no-restricted-imports');
    expect(await lint("import { complete } from '../../engine/src/llm/adapter';\nexport const y = complete;\n")).toContain(
      '@typescript-eslint/no-restricted-imports',
    );
    expect(await lint("import type { Llm } from './llm';\nexport type Y = Llm;\n")).toContain('@typescript-eslint/no-restricted-imports');
    expect(await lint("export const load = () => import('../../engine/src/llm/adapter');\n")).toContain('no-restricted-syntax');
  });

  it('applies to contracts as well', async () => {
    expect(await lint("import { x } from '@hackwave/engine';\nexport const y = x;\n", 'packages/contracts/src/probe.ts')).toContain(
      '@typescript-eslint/no-restricted-imports',
    );
  });

  it('lets the planner use the LLM adapter but never the executor', async () => {
    const code = "import { LlmAdapter } from './llm';\nexport const y = LlmAdapter;\n";
    expect(await lint(code, 'packages/engine/src/planner.ts')).not.toContain('@typescript-eslint/no-restricted-imports');
    expect(await lint(code, 'packages/engine/src/executor.ts')).toContain('@typescript-eslint/no-restricted-imports');
  });
});

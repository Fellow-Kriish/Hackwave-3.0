import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyRungHistogram, type RunRecord } from '@hackwave/contracts';
import { createVerifier } from '@hackwave/verifier';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileFor, serveSite } from '../../../apps/demo-sites/serve.mjs';
import { findRepoRoot } from './paths';
import { loadProjects } from './projects';
import { fetchCatalog, typedIntent } from './typed-goal';

/**
 * The demo sites end to end, with no model: each version is driven through a scripted purchase or booking in a real
 * browser, then judged by the real verifier through the real project file. V1 and V2 save what they confirm; V3 shows
 * the same confirmation and saves nothing, so it must fail.
 */
const root = findRepoRoot();
const projects = loadProjects(root);
const record = (): RunRecord => ({
  runId: 'r',
  intentId: 'typed',
  target: 'http://127.0.0.1/',
  startedAt: '2026-10-12T00:00:00.000Z',
  endedAt: '2026-10-12T00:00:05.000Z',
  outcome: 'completed',
  reason: null,
  terminalAttempted: true,
  healerBelievedDone: { believed: true, atStep: 6, stepKey: 'confirm.submit' },
  actions: 6,
  lastStepKey: 'confirm.submit',
  heals: [],
  replans: [],
  rungHistogram: emptyRungHistogram(),
  llmCalls: { total: 0, cached: 0, byModel: {} },
  tokens: { input: 0, output: 0, byModel: {} },
  timings: { browserMs: 0, llmMs: 0, totalMs: 0, steps: [] },
  environmentErrors: [],
});

type Site = 'shopsphere' | 'harbor-pine';
type Version = 'v1' | 'v2' | 'v3';

const flows: Record<Site, { goal: string; product: string; act: (page: Page, version: Version) => Promise<string> }> = {
  shopsphere: {
    goal: 'Buy the Cloud Wireless Headphones',
    product: 'Cloud Wireless Headphones',
    async act(page, version) {
      const card = page.getByRole('article', { name: 'Cloud Wireless Headphones' });
      if (version === 'v1') {
        await card.getByRole('button', { name: 'Add to Cart' }).click();
        await page.getByLabel('Full Name').fill('Kartik Test');
        await page.getByLabel('Email Address').fill('kartik@example.com');
        await page.getByLabel('Delivery Address').fill('12 MG Road');
        await page.getByRole('button', { name: 'Place Order' }).click();
        return page.getByTestId('order-result').innerText();
      }
      await card.getByRole('button', { name: '+ Add to cart' }).click();
      await page.getByTestId('cart-toggle').click();
      await page.getByTestId('checkout-button').click();
      await page.getByTestId('customer-name').fill('Kartik Test');
      await page.getByTestId('customer-email').fill('kartik@example.com');
      await page.getByTestId('customer-address').fill('12 MG Road');
      await page.getByTestId('customer-city').fill('Indore');
      await page.getByTestId('customer-zip').fill('452001');
      await page.getByTestId('terms-check').check();
      await page.getByTestId('place-order').click();
      return page.locator('#order-success-message').innerText();
    },
  },
  'harbor-pine': {
    goal: 'Book the Harbor Suite',
    product: 'Harbor Suite',
    async act(page, version) {
      await page.getByRole('article', { name: 'Harbor Suite' }).first().getByRole('button').first().click();
      await page.getByTestId('guest-name').fill('Kartik Test');
      await page.getByTestId('guest-email').fill('kartik@example.com');
      if (version === 'v1') await page.getByTestId('guest-phone').fill('9876543210');
      await page.getByTestId('confirm-booking').click();
      return version === 'v1' ? page.getByTestId('booking-message').innerText() : page.locator('#booking-success-message').innerText();
    },
  },
};

describe('the demo sites, judged by the verifier through their project files', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  for (const site of ['shopsphere', 'harbor-pine'] as const) {
    for (const version of ['v1', 'v2', 'v3'] as const) {
      const saves = version !== 'v3';
      it(`${site} ${version}: ${saves ? 'saves what it confirms, so it passes' : 'confirms but saves nothing, so it fails'}`, async () => {
        const server: Server = await serveSite(site, version, 0);
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const evidenceDir = mkdtempSync(join(tmpdir(), 'hw-sites-'));
        const page = await (await browser.newContext()).newPage();
        try {
          const project = projects.find((candidate) => candidate.id === site);
          if (!project) throw new Error(`projects/${site}.json is missing`);
          const store = Object.keys(project.stores)[0] ?? 'orders';
          const { intent } = typedIntent(flows[site].goal, project.inputs ?? {}, await fetchCatalog(origin, fetch, project.catalog), store);
          expect(intent.oracle.state.match.items).toEqual([flows[site].product]);
          const verifier = createVerifier(intent, { origin, evidenceDir, defaultPollMs: 600, pollIntervalMs: 100, bindingWaitMs: 500, stores: project.stores });
          expect(verifier.needsPage).toBe(true);

          await page.goto(origin);
          expect((await verifier.baseline(page)).count).toBe(0);
          const confirmation = await flows[site].act(page, version);
          expect(confirmation).toMatch(/#(1001|2001)/);

          const result = await verifier.verify(page, record());
          if (saves) {
            expect([result.state.status, result.binding.status, result.alerts.status]).toEqual(['pass', 'pass', 'pass']);
          } else {
            expect(result.state.status).toBe('fail');
            expect(result.state.summary).toContain('found 0');
            // The page claimed success: the report quotes that claim, not the hero heading.
            expect(result.finalHeading).toMatch(/#(1001|2001) is confirmed/);
          }
        } finally {
          await page.context().close();
          await new Promise((resolve) => server.close(resolve));
          rmSync(evidenceDir, { recursive: true, force: true });
        }
      }, 30_000);
    }
  }

  it('serves only files inside each version folder', () => {
    const rootDir = join(root, 'apps', 'demo-sites', 'shopsphere', 'v2');
    expect(fileFor(rootDir, '/')).toBe(join(rootDir, 'index.html'));
    expect(fileFor(rootDir, '/script.js?x=1')).toBe(join(rootDir, 'script.js'));
    expect(fileFor(rootDir, '/../v3/script.js')).toBe(null);
    expect(fileFor(rootDir, '/..%2F..%2F..%2Fpackage.json')).toBe(null);
    expect(fileFor(rootDir, '/missing.html')).toBe(null);
  });
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, Intent, OracleResult, RunRecord, StoreConfig } from '@hackwave/contracts';
import type { Page } from 'playwright';
import { baselineOf, checkAlerts, checkBinding, checkStateDelta, normalise, type Baseline } from './checks';
import { browserStorageStore, httpStore, type StoreAdapter } from './store';

export interface VerifierOptions {
  /** Origin of the app under test; the store lives at <origin>/api/<store>. */
  origin: string;
  /** The run folder's evidence/ directory. */
  evidenceDir: string;
  /** engine.config.json verifier.pollMs, used when the oracle sets no pollMs. */
  defaultPollMs: number;
  pollIntervalMs?: number;
  /** Override the HTTP store (tests). */
  store?: StoreAdapter;
  /** The matched project's stores (projects/<id>.json); without one, the store is <origin>/api/<store> as sent. */
  stores?: Record<string, StoreConfig>;
  /**
   * Once the new record exists, how long the page gets to show its id before the page is read (default 3000 ms). An app
   * that navigates to its confirmation only after the save returns is not a bug for being a moment slow.
   */
  bindingWaitMs?: number;
}

export interface Verifier {
  /**
   * True when the store lives in the browser (a project's browser-storage store): baseline() then needs the test's page,
   * opened on the app, instead of running before the browser starts.
   */
  readonly needsPage: boolean;
  /** Snapshot the store before step 1. Throws if the store cannot be read: a setup error, not a verdict. */
  baseline(page?: Page): Promise<Baseline>;
  /** Evaluate the oracle against the store and the final page, writing the evidence bundle. */
  verify(page: Page | null, run: RunRecord): Promise<OracleResult>;
}

interface FinalPage {
  url: string | null;
  text: string | null;
  alerts: string[] | null;
  heading: string | null;
}

async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

const check = (status: CheckResult['status'], summary: string): CheckResult => ({ status, summary, compared: [] });

/** Words a page uses when it claims the goal succeeded. */
const CONFIRMATION = /\b(confirmed|confirmation|thank you|thanks|booked|successful(ly)?|placed)\b/i;

/**
 * What the page claimed, for the report's "the page said …": the main heading when it reads like a confirmation (a
 * confirmation page), else the visible text that does, preferring one with a reference number (a one-page app's dialog or
 * status line), else the main heading. Narration only: no check reads it.
 */
async function claimOf(page: Page, heading: string | null): Promise<string | null> {
  if (heading && CONFIRMATION.test(heading)) return heading;
  const texts = await attempt(async () => {
    const found: string[] = [];
    for (const node of (await page.getByText(CONFIRMATION).all()).slice(0, 12)) {
      if (await node.isVisible()) found.push((await node.innerText({ timeout: 500 })).replace(/\s+/g, ' ').trim());
    }
    return found.filter((text) => text.length > 0);
  });
  const best = texts?.find((text) => /\d/.test(text)) ?? texts?.[0];
  return best ? best.slice(0, 160) : heading;
}

/**
 * The verifier is the only reader of the oracle. It has no LLM dependency (lint-enforced) and anchors on
 * the system of record: the page can lie, the orders store cannot.
 */
export function createVerifier(intent: Intent, options: VerifierOptions): Verifier {
  const { oracle } = intent;
  const config = options.stores?.[oracle.state.store];
  // The page a browser-storage store reads from: set by baseline() and verify(), which both receive it.
  let activePage: Page | null = null;
  const store =
    options.store ??
    (config?.kind === 'browser-storage' ? browserStorageStore(oracle.state.store, config, () => activePage) : httpStore(options.origin, oracle.state.store, 3000, config));
  const pollMs = oracle.state.pollMs ?? options.defaultPollMs;
  const intervalMs = options.pollIntervalMs ?? 250;
  mkdirSync(options.evidenceDir, { recursive: true });
  const write = (file: string, content: string | Buffer) => writeFileSync(join(options.evidenceDir, file), content);
  const writeJson = (file: string, value: unknown) => write(file, `${JSON.stringify(value, null, 2)}\n`);
  let baseline: Baseline | null = null;

  async function captureFinalPage(page: Page | null): Promise<FinalPage> {
    if (!page || page.isClosed()) return { url: null, text: null, alerts: null, heading: null };
    const url = await attempt(async () => page.url());
    const text = await attempt(() => page.locator('body').innerText({ timeout: 3000 }));
    const alerts = await attempt(() => page.getByRole('alert').allInnerTexts());
    const heading = await attempt(() => page.getByRole('heading', { level: 1 }).first().innerText({ timeout: 1000 }));
    const screenshot = await attempt(() => page.screenshot({ fullPage: true, timeout: 5000 }));
    const aria = await attempt(() => page.locator('body').ariaSnapshot({ timeout: 3000 }));
    if (screenshot) write('final.png', screenshot);
    if (aria !== null) write('final-aria.yml', `${aria}\n`);
    if (url !== null) write('final-url.txt', `${url}\n`);
    return { url, text, alerts, heading: await claimOf(page, heading?.trim() || null) };
  }

  /** Polls the page text until the record id shows (normalised, as checkBinding compares) or the wait runs out. */
  async function waitForId(page: Page | null, id: string): Promise<void> {
    if (!page || page.isClosed()) return;
    const needle = normalise(id);
    const deadline = Date.now() + (options.bindingWaitMs ?? 3000);
    while (Date.now() < deadline) {
      const text = await attempt(() => page.locator('body').innerText({ timeout: 1000 }));
      if (text !== null && normalise(text).includes(needle)) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return {
    needsPage: !options.store && config?.kind === 'browser-storage',
    async baseline(page) {
      activePage = page ?? null;
      const records = await store.list();
      baseline = baselineOf(records);
      writeJson('baseline.json', { store: store.url, ...baseline, records });
      return baseline;
    },

    async verify(page, run) {
      if (!baseline) throw new Error('verify() called before baseline()');
      activePage = page;
      const baseOf = (finalPage: FinalPage) => ({
        baseline: { count: baseline?.count ?? 0, maxId: baseline?.maxId ?? null },
        finalUrl: finalPage.url,
        finalHeading: finalPage.heading,
      });

      // Nothing was submitted if the terminal action never ran: the run's own outcome decides the verdict.
      if (!run.terminalAttempted && run.outcome !== 'completed') {
        const base = baseOf(await captureFinalPage(page));
        const skipped = check('skipped', 'not evaluated: the terminal action was never attempted');
        const result: OracleResult = { ...base, evaluated: false, newRecordId: null, state: skipped, binding: skipped, alerts: skipped };
        writeJson('oracle.json', result);
        return result;
      }

      const state = await checkStateDelta({
        store,
        baseline,
        expectedNewCount: oracle.state.expectedNewCount,
        match: oracle.state.match,
        pollMs,
        intervalMs,
      });
      writeJson('store-after.json', { store: store.url, listing: state.listing, newRecord: state.record, readBack: state.fetched });

      // The page is read after the store, not before: the store check waits for the save, and once the record exists the
      // page gets a short, bounded wait to show its id. Reading it the instant the terminal click returns judged an app
      // that navigates after its save completes as never confirming the order.
      if (state.record && oracle.ui.newRecordIdVisible) await waitForId(page, String(state.record.id));
      const finalPage = await captureFinalPage(page);
      const base = baseOf(finalPage);

      // Without the system of record nothing can be judged, so the page checks wait for the store.
      const storeDown = state.result.status === 'error';
      const binding: CheckResult = !oracle.ui.newRecordIdVisible
        ? check('disabled', 'switched off by the oracle')
        : storeDown
          ? check('skipped', 'not evaluated: the store could not be read')
          : !state.record
            ? check('skipped', 'not evaluated: there is no single new record to look for')
            : finalPage.text === null
              ? check('error', 'the final page could not be read')
              : checkBinding(state.record.id, finalPage.text);
      const alerts: CheckResult = !oracle.ui.noAlerts
        ? check('disabled', 'switched off by the oracle')
        : storeDown
          ? check('skipped', 'not evaluated: the store could not be read')
          : finalPage.alerts === null
            ? check('error', 'the final page could not be read')
            : checkAlerts(finalPage.alerts);

      const result: OracleResult = {
        ...base,
        evaluated: true,
        newRecordId: state.record?.id ?? null,
        state: state.result,
        binding,
        alerts,
      };
      writeJson('oracle.json', result);
      return result;
    },
  };
}

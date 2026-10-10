import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, Intent, OracleResult, RunRecord } from '@hackwave/contracts';
import type { Page } from 'playwright';
import { baselineOf, checkAlerts, checkBinding, checkStateDelta, type Baseline } from './checks';
import { httpStore, type StoreAdapter } from './store';

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
}

export interface Verifier {
  /** Snapshot the store before step 1. Throws if the store cannot be read: a setup error, not a verdict. */
  baseline(): Promise<Baseline>;
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

/**
 * The verifier is the only reader of the oracle. It has no LLM dependency (lint-enforced) and anchors on
 * the system of record: the page can lie, the orders store cannot.
 */
export function createVerifier(intent: Intent, options: VerifierOptions): Verifier {
  const { oracle } = intent;
  const store = options.store ?? httpStore(options.origin, oracle.state.store);
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
    return { url, text, alerts, heading: heading?.trim() ?? null };
  }

  return {
    async baseline() {
      const records = await store.list();
      baseline = baselineOf(records);
      writeJson('baseline.json', { store: store.url, ...baseline, records });
      return baseline;
    },

    async verify(page, run) {
      if (!baseline) throw new Error('verify() called before baseline()');
      const finalPage = await captureFinalPage(page);
      const base = {
        baseline: { count: baseline.count, maxId: baseline.maxId },
        finalUrl: finalPage.url,
        finalHeading: finalPage.heading,
      };

      // Nothing was submitted if the terminal action never ran: the run's own outcome decides the verdict.
      if (!run.terminalAttempted && run.outcome !== 'completed') {
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

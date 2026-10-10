import { performance } from 'node:perf_hooks';
import type { Page } from 'playwright';
import { capturePage, type PageState } from './aria';

export interface SettleConfig {
  sampleGapMs: number;
  maxWaitMs: number;
}

export interface SettleResult {
  settled: boolean;
  waitedMs: number;
  state: PageState;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Settle gate: wait until the aria hash (live regions ignored) is the same in two samples sampleGapMs apart.
 * Gives up after maxWaitMs and lets the run proceed; it never blocks longer than that.
 */
export async function settle(page: Page, config: SettleConfig): Promise<SettleResult> {
  const started = performance.now();
  let previous = await capturePage(page);
  for (;;) {
    await delay(config.sampleGapMs);
    const current = await capturePage(page);
    const waitedMs = Math.round(performance.now() - started);
    if (current.stableHash === previous.stableHash) return { settled: true, waitedMs, state: current };
    if (waitedMs >= config.maxWaitMs) return { settled: false, waitedMs, state: current };
    previous = current;
  }
}

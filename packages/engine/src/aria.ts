import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

/** Live regions change on their own (announcements, timers); the settle gate ignores them. */
const LIVE_REGION = /^(\s*)- (status|alert|timer|log|marquee)\b/;

/** Removes live-region nodes, and everything nested under them, from an aria snapshot. */
export function stripLiveRegions(snapshot: string): string {
  const kept: string[] = [];
  let skipDeeperThan: number | null = null;
  for (const line of snapshot.split('\n')) {
    const indent = line.length - line.trimStart().length;
    if (skipDeeperThan !== null) {
      if (indent > skipDeeperThan) continue;
      skipDeeperThan = null;
    }
    if (LIVE_REGION.test(line)) {
      skipDeeperThan = indent;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface PageState {
  url: string;
  /** Hash of the whole aria tree, live regions included: what progress checks compare. */
  fullHash: string;
  /** Hash without live regions: what the settle gate compares. */
  stableHash: string;
}

/** Uses locator.ariaSnapshot(); page.accessibility.snapshot() is deprecated and never used. */
export async function capturePage(page: Page): Promise<PageState> {
  const snapshot = await page.locator('body').ariaSnapshot({ timeout: 3000 });
  return { url: page.url(), fullHash: hashText(snapshot), stableHash: hashText(stripLiveRegions(snapshot)) };
}

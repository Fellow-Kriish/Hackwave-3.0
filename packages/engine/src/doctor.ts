import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { EngineConfig } from './config';
import { describeTier, readManifest, resolveLlmSettings } from './llm';

export interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

const TIMEOUT_MS = 3000;

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}

async function request(url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body: unknown = await response.json().catch(() => undefined);
  return { status: response.status, body };
}

/**
 * Preflight before any run. Failures here are setup errors, reported before a run starts and never a GREY verdict.
 * With reset: true it also clears every shop's store through the test-only endpoint.
 */
/** Replay mode needs the recorded cache; live and record need a configured model. */
function llmCheck(config: EngineConfig, root: string): Check {
  const cacheDir = join(root, 'runs', 'llm-cache');
  try {
    const manifest = readManifest(cacheDir);
    const settings = resolveLlmSettings(config, process.env, manifest);
    if (settings.mode === 'replay') {
      if (!manifest) return { name: 'replay cache', status: 'fail', detail: 'LLM_MODE is replay but runs/llm-cache has no manifest; record first with LLM_MODE=record' };
      const entries = readdirSync(cacheDir).filter((file) => file.endsWith('.json') && file !== 'manifest.json').length;
      return { name: 'replay cache', status: 'pass', detail: `${entries} recorded call(s), pinned to ${describeTier(settings.tiers.strong)}; no API key needed` };
    }
    const strong = settings.tiers.strong;
    return strong.ok
      ? { name: 'llm', status: 'pass', detail: `${settings.mode} mode · strong ${describeTier(strong)} · fast ${describeTier(settings.tiers.fast)}` }
      : { name: 'llm', status: 'fail', detail: `${settings.mode} mode but the strong tier is ${describeTier(strong)}` };
  } catch (error) {
    return { name: 'llm', status: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function runDoctor(config: EngineConfig, options: { reset: boolean; root: string }): Promise<Check[]> {
  const checks: Check[] = [];

  for (const [version, port] of Object.entries(config.shop.ports)) {
    const base = `http://127.0.0.1:${port}`;
    const skipRest = (why: string) => {
      checks.push({ name: `reset ${version}`, status: 'skip', detail: why });
      checks.push({ name: `baseline ${version}`, status: 'skip', detail: why });
    };

    let health: { version?: unknown; testMode?: unknown };
    try {
      const { status, body } = await request(`${base}/api/_health`);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      health = (body ?? {}) as typeof health;
    } catch (error) {
      checks.push({
        name: `shop ${version}`,
        status: 'fail',
        detail: `nothing answering on port ${port} (${reason(error)}); start the shops with: pnpm shop`,
      });
      skipRest('shop not reachable');
      continue;
    }
    if (health.version !== version) {
      checks.push({
        name: `shop ${version}`,
        status: 'fail',
        detail: `port ${port} serves ${String(health.version)}, expected ${version}`,
      });
      skipRest('wrong shop on this port');
      continue;
    }
    checks.push({ name: `shop ${version}`, status: 'pass', detail: `http://localhost:${port} serves ${version}` });

    if (health.testMode !== true) {
      checks.push({
        name: `reset ${version}`,
        status: 'fail',
        detail: 'test-only reset endpoint is off; start the shop with SHOP_TEST_MODE=1 (pnpm shop does this)',
      });
    } else if (options.reset) {
      try {
        const { status, body } = await request(`${base}/api/_test/reset`, { method: 'POST' });
        const result = (body ?? {}) as { ok?: unknown; nextId?: unknown };
        if (status !== 200 || result.ok !== true) throw new Error(`HTTP ${status}`);
        checks.push({ name: `reset ${version}`, status: 'pass', detail: `store cleared, next order id ${String(result.nextId)}` });
      } catch (error) {
        checks.push({ name: `reset ${version}`, status: 'fail', detail: `reset failed (${reason(error)})` });
      }
    } else {
      checks.push({
        name: `reset ${version}`,
        status: 'pass',
        detail: 'endpoint enabled (SHOP_TEST_MODE=1); pass --reset to clear the store',
      });
    }

    try {
      const { status, body } = await request(`${base}/api/orders`);
      if (status !== 200 || !Array.isArray(body)) throw new Error(`GET /api/orders returned HTTP ${status}`);
      const ids = body
        .map((order) => (order as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
      const maxId = ids.length > 0 ? `, max id ${Math.max(...ids)}` : '';
      checks.push({ name: `baseline ${version}`, status: 'pass', detail: `orders store readable: ${body.length} orders${maxId}` });
    } catch (error) {
      checks.push({ name: `baseline ${version}`, status: 'fail', detail: reason(error) });
    }
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const browserVersion = browser.version();
    await browser.close();
    checks.push({ name: 'browser', status: 'pass', detail: `Chromium ${browserVersion} launches headless` });
  } catch (error) {
    checks.push({
      name: 'browser',
      status: 'fail',
      detail: `Chromium did not launch (${reason(error)}); run: pnpm --filter @hackwave/engine exec playwright install chromium`,
    });
  }

  checks.push(llmCheck(config, options.root));
  return checks;
}

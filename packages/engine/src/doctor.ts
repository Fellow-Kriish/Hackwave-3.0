import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@hackwave/contracts';
import { chromium } from 'playwright';
import type { EngineConfig } from './config';
import { lintIntentText } from './intent-lint';
import { describeTier, loadPrompt, readManifest, resolveLlmSettings, type Manifest, type PromptFile } from './llm';
import { LocatorCache } from './locator-cache';
import { loadCachedPlan } from './plan-cache';
import { planPromptHash } from './planner';

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

const MIN_NODE = [20, 19] as const;

function nodeCheck(): Check {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  return { name: 'node', status: ok ? 'pass' : 'fail', detail: `Node ${process.versions.node}${ok ? '' : `; ${MIN_NODE.join('.')} or newer is needed`}` };
}

/** Every prompt the engine calls with. A RED hypothesis missing from the replay cache is skipped, never a failure. */
const PROMPTS = ['planner', 'expand', 'resolve', 'replan', 'explain'] as const;
const OPTIONAL_IN_REPLAY = new Set<string>(['explain']);

/**
 * Prompt files load with their version line, and still match what the replay cache was recorded with: a prompt
 * edited since recording means replay misses every call that uses it.
 */
export function promptsCheck(prompts: readonly PromptFile[], manifest: Manifest | null, mode: string): Check {
  const versions = prompts.map((prompt) => prompt.version).join(', ');
  if (!manifest) return { name: 'prompts', status: 'pass', detail: `${versions}; nothing recorded yet` };
  const changed = prompts.filter((prompt) => manifest.prompts[prompt.name] !== undefined && manifest.prompts[prompt.name] !== prompt.hash).map((prompt) => prompt.name);
  const unrecorded = prompts.filter((prompt) => manifest.prompts[prompt.name] === undefined).map((prompt) => prompt.name);
  const parts = [versions];
  if (changed.length > 0) parts.push(`changed since recording: ${changed.join(', ')} (re-record with --llm-mode record)`);
  if (unrecorded.length > 0) parts.push(`never recorded: ${unrecorded.join(', ')}`);
  if (changed.length === 0 && unrecorded.length === 0) parts.push('all match the replay cache');
  const blocking = mode === 'replay' ? changed.filter((name) => !OPTIONAL_IN_REPLAY.has(name)) : [];
  return { name: 'prompts', status: blocking.length > 0 ? 'fail' : 'pass', detail: parts.join('; ') };
}

/** Every intent under intents/ lints clean, and its cached plan and locators load. */
function intentChecks(root: string, prompts: readonly PromptFile[]): Check[] {
  const dir = join(root, 'intents');
  const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];
  if (files.length === 0) return [{ name: 'intents', status: 'fail', detail: 'no intents/*.json; scaffold one with pnpm engine init "<goal>"' }];
  const byName = new Map(prompts.map((prompt) => [prompt.name, prompt]));
  const plan = byName.get('planner');
  const expand = byName.get('expand');
  const checks: Check[] = [];
  const valid: string[] = [];
  for (const file of files) {
    const result = lintIntentText(readFileSync(join(dir, file), 'utf8'));
    if (!result.intent) {
      const first = result.problems[0];
      checks.push({ name: `intent ${file}`, status: 'fail', detail: `${result.problems.length} problem(s)${first ? `, first: ${first.path || '(file)'} ${first.message}` : ''}; see pnpm engine lint intents/${file}` });
      continue;
    }
    valid.push(result.intent.id);
    const notes: string[] = [];
    let failed = false;
    if (plan && expand) {
      const cached = loadCachedPlan(root, result.intent.id, sha256(result.intent.goal), planPromptHash({ plan, expand }));
      if (cached.plan) notes.push(`plan cached (${cached.plan.milestones.length} milestones)`);
      else if (cached.reason === 'no cached plan') notes.push('no cached plan: the planner writes one');
      else {
        notes.push(`cached plan not used: ${cached.reason}`);
        failed = true;
      }
    }
    for (const hand of [false, true]) {
      const locators = LocatorCache.load(root, result.intent.id, hand);
      if (locators.problem) {
        notes.push(`${hand ? 'hand ' : ''}locator cache ignored: ${locators.problem}`);
        failed = true;
      } else if (!hand && existsSync(locators.file)) notes.push('locator cache loads');
    }
    checks.push({ name: `intent ${file}`, status: failed ? 'fail' : 'pass', detail: `${result.intent.id}: ${notes.join('; ')}` });
  }
  return checks;
}

export async function runDoctor(config: EngineConfig, options: { reset: boolean; root: string }): Promise<Check[]> {
  const checks: Check[] = [nodeCheck()];

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

  const prompts: PromptFile[] = [];
  const unreadable: string[] = [];
  for (const name of PROMPTS) {
    try {
      prompts.push(loadPrompt(options.root, name));
    } catch (error) {
      unreadable.push(reason(error));
    }
  }
  if (unreadable.length > 0) {
    checks.push({ name: 'prompts', status: 'fail', detail: unreadable.join('; ') });
  } else {
    let mode = 'replay';
    try {
      mode = resolveLlmSettings(config, process.env, readManifest(join(options.root, 'runs', 'llm-cache'))).mode;
    } catch {
      // llmCheck above already reports a bad LLM setting.
    }
    checks.push(promptsCheck(prompts, readManifest(join(options.root, 'runs', 'llm-cache')), mode));
  }
  checks.push(...intentChecks(options.root, prompts));
  return checks;
}

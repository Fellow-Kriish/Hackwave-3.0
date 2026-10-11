import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { Intent } from '@hackwave/contracts';
import { describeEvent } from '../console';
import { lintIntentText } from '../intent-lint';
import { locatorCacheFile } from '../locator-cache';
import { findRepoRoot } from '../paths';
import { planCacheFile } from '../plan-cache';
import { healerLine } from '../report';
import { runIntent, SetupError } from '../run';
import { freePort, resetStore, startPrivateShop, type PrivateShop } from '../shop-process';
import { fetchCatalog, typedIntent } from '../typed-goal';
import { renderPage } from './page';

export type Version = 'v1' | 'v2' | 'v2-broken' | 'v2-wrong-total';

export const VERSIONS: Record<Version, string> = {
  v1: 'Version A (the original)',
  v2: 'Version B (the redesign)',
  'v2-broken': 'Version B with a backend bug (confirms orders, saves nothing)',
  'v2-wrong-total': 'Version B with a pricing bug (saves the wrong total)',
};

/** The guided demo: one sentence, four steps, one address. */
export const GUIDED_STEPS: readonly { version: Version; fresh: boolean; title: string; say: string }[] = [
  {
    version: 'v1',
    fresh: true,
    title: 'Version A: the AI reads the site and plans the test from your sentence',
    say: 'I only typed the goal. It reads the page, plans the clicks and checks the real order store.',
  },
  {
    version: 'v2',
    fresh: false,
    title: 'Version B deployed to the same address: the same sentence, nothing rewritten',
    say: 'Renamed buttons, a new flow, a new required field. It notices, rebuilds its steps from the goal, passes, and says what changed.',
  },
  {
    version: 'v2-broken',
    fresh: false,
    title: 'Version B with a backend bug: the page will say the order is confirmed',
    say: 'Same UI, but nothing is saved. The page lies; the store does not. It stays red.',
  },
  {
    version: 'v2',
    fresh: false,
    title: 'Version B again: it learned',
    say: 'Healing is a one-time cost: this run needs no AI at all.',
  },
];

const MAX_BODY_BYTES = 10_000;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webm': 'video/webm',
};

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const comparable = (text: string) => collapse(text).toLowerCase().replace(/[.!]+$/, '');

/**
 * A file under runs/ for a URL like /runs/<run folder>/report.html, or null. Nothing outside runs/ is ever served,
 * whatever the path says.
 */
export function resolveRunFile(runsDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.replace(/^\/runs\//, ''));
  } catch {
    return null;
  }
  if (!decoded || decoded.includes('\0')) return null;
  const file = resolve(runsDir, normalize(decoded));
  const inside = relative(resolve(runsDir), file);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/** The intent under intents/ whose goal reads the same as a typed one (case, spaces, a final full stop aside). */
export function knownIntentFor(root: string, goal: string): Intent | null {
  const dir = join(root, 'intents');
  if (!existsSync(dir)) return null;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const { intent } = lintIntentText(readFileSync(join(dir, file), 'utf8'));
    if (intent && comparable(intent.goal) === comparable(goal)) return intent;
  }
  return null;
}

export interface UiOptions {
  port: number;
  headed: boolean;
  slowMo: number;
}

export interface UiServer {
  url: string;
  close(): Promise<void>;
}

interface RunRequest {
  goal: string;
  version: Version;
  /** Use the live model even for a goal that has recorded answers. */
  live: boolean;
  /** Forget what was learned for this goal first: the AI plans from scratch. */
  fresh: boolean;
}

/**
 * The web app: a page where a tester types a goal, picks the version of the app, and watches the engine plan, act,
 * heal and verify, live. It runs the same engine as the CLI against its own shop at one address.
 */
export async function startUiServer(options: UiOptions): Promise<UiServer> {
  const root = findRepoRoot();
  const runsDir = join(root, 'runs');
  const shopPort = await freePort();
  const address = `http://localhost:${shopPort}`;
  const checkoutFile = join(root, 'intents', 'checkout.json');
  const checkout = existsSync(checkoutFile) ? lintIntentText(readFileSync(checkoutFile, 'utf8')).intent : null;
  // The recorded goal runs offline; the examples are new sentences the live model plans.
  const defaultGoal = checkout?.goal ?? 'Complete checkout with a valid credit card';
  const examples = ['Complete checkout with a valid credit card', 'Buy the City Sneaker and pay by credit card'];
  const clients = new Set<ServerResponse>();
  const history: Record<string, unknown>[] = [];
  let shop: PrivateShop | null = null;
  let deployed: Version | null = null;
  let busy = false;

  const send = (message: Record<string, unknown>) => {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of clients) client.write(data);
  };
  const state = () => ({
    type: 'state',
    address,
    deployed,
    deployedLabel: deployed ? VERSIONS[deployed] : null,
    busy,
    defaultGoal,
    examples,
    versions: VERSIONS,
    steps: GUIDED_STEPS,
    liveAvailable: Boolean(process.env.LLM_API_KEY) && process.env.LLM_API_KEY !== 'replace-me',
    history,
  });
  const setBusy = (value: boolean) => {
    busy = value;
    send({ type: 'busy', busy });
  };

  async function deploy(version: Version): Promise<string> {
    if (deployed !== version || !shop) {
      if (shop) await shop.stop();
      shop = null;
      deployed = null;
      send({ type: 'line', tone: 'warn', text: `▶ deploying ${VERSIONS[version]} to ${address} ...` });
      shop = await startPrivateShop(root, version, shopPort);
      deployed = version;
      send({ ...state(), type: 'state' });
    }
    return shop.origin;
  }

  async function runOne(request: RunRequest, label: string): Promise<boolean> {
    const origin = await deploy(request.version);
    await resetStore(origin);
    const known = knownIntentFor(root, request.goal);
    // A goal we have recorded answers for replays them (offline); a new sentence is planned by the live model.
    const goal = known?.goal ?? collapse(request.goal);
    const base = known ?? checkout;
    if (!base) throw new SetupError('intents/checkout.json is missing: it supplies the test data (card, address, phone)');
    const { intent, notes } = typedIntent(goal, base.inputs, await fetchCatalog(origin));
    const file = join(runsDir, 'typed', `${intent.id}.json`);
    mkdirSync(join(runsDir, 'typed'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(intent, null, 2)}\n`);
    if (request.fresh) for (const cache of [planCacheFile(root, intent.id), locatorCacheFile(root, intent.id)]) rmSync(cache, { force: true });
    const mode = request.live || !known ? 'live' : 'replay';
    send({ type: 'run', label, goal, version: request.version, versionLabel: VERSIONS[request.version], address, mode, fresh: request.fresh, notes });
    const result = await runIntent({
      intentFile: file,
      target: origin,
      headed: options.headed,
      slowMo: options.slowMo,
      quiet: true,
      envOverride: { LLM_MODE: mode },
      onEvent: (event) => {
        for (const line of describeEvent(event)) send({ type: 'line', ...line });
      },
    });
    const { verdict } = result;
    const entry = {
      label,
      goal,
      version: request.version,
      versionLabel: VERSIONS[request.version],
      color: verdict.color,
      kind: verdict.kind,
      summary: result.summary,
      whatChanged: result.whatChanged,
      healer: healerLine(verdict),
      checks: (['state', 'binding', 'alerts'] as const).map((name) => ({ name, status: verdict.oracle[name].status, summary: verdict.oracle[name].summary })),
      heals: verdict.heals.length,
      replans: verdict.replans.length,
      llmCalls: verdict.llmCalls.total,
      llmCached: verdict.llmCalls.cached,
      mode,
      seconds: Math.round(verdict.timings.totalMs / 100) / 10,
      hypothesis: result.explanation && 'hypothesis' in result.explanation ? result.explanation.hypothesis : null,
      reportUrl: `/runs/${encodeURIComponent(basename(result.runDir))}/report.html`,
    };
    history.unshift(entry);
    send({ type: 'result', ...entry });
    return true;
  }

  async function guard(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hint = /needs a model|not configured|LLM_API_KEY/i.test(message)
        ? 'A new sentence is planned by the live AI: put LLM_API_KEY (and the models) in .env, or use the recorded goal, which runs offline.'
        : null;
      send({ type: 'error', message, hint });
    } finally {
      setBusy(false);
    }
  }

  const readBody = (request: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error('request too large'));
          request.destroy();
        } else chunks.push(chunk);
      });
      request.on('end', () => {
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>);
        } catch {
          reject(new Error('the body is not JSON'));
        }
      });
      request.on('error', reject);
    });

  const parseRun = (body: Record<string, unknown>): RunRequest | string => {
    const goal = typeof body.goal === 'string' ? collapse(body.goal) : '';
    if (goal.length < 10 || goal.length > 300) return 'write the goal as one sentence (10 to 300 characters)';
    const version = (typeof body.version === 'string' ? body.version : 'v1') as Version;
    if (!(version in VERSIONS)) return `unknown version "${version}"`;
    return { goal, version, live: body.live === true, fresh: body.fresh === true };
  };

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const own = `http://${request.headers.host ?? ''}`;
      // Only this page may start runs: a request from another site, or a simple cross-site form post, is refused.
      if (request.method === 'POST') {
        const origin = request.headers.origin;
        if ((origin && origin !== own) || !(request.headers['content-type'] ?? '').startsWith('application/json')) {
          json(response, 403, { error: 'forbidden' });
          return;
        }
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(renderPage());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, state());
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        response.write(`data: ${JSON.stringify(state())}\n\n`);
        clients.add(response);
        const ping = setInterval(() => response.write(': ping\n\n'), 15_000);
        request.on('close', () => {
          clearInterval(ping);
          clients.delete(response);
        });
        return;
      }
      if (request.method === 'POST' && (url.pathname === '/api/run' || url.pathname === '/api/demo')) {
        if (busy) return json(response, 409, { error: 'a test is already running' });
        let body: Record<string, unknown>;
        try {
          body = await readBody(request);
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        const parsed = parseRun(body);
        if (typeof parsed === 'string') return json(response, 400, { error: parsed });
        json(response, 202, { started: true });
        if (url.pathname === '/api/run') {
          void guard(async () => {
            await runOne(parsed, VERSIONS[parsed.version]);
          });
        } else {
          void guard(async () => {
            for (const [index, step] of GUIDED_STEPS.entries()) {
              send({ type: 'step', index, title: step.title, say: step.say });
              await runOne({ ...parsed, version: step.version, fresh: step.fresh }, `Step ${index + 1} · ${VERSIONS[step.version]}`);
            }
            send({ type: 'step', index: GUIDED_STEPS.length, title: 'Done', say: '' });
          });
        }
        return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/runs/')) {
        const file = resolveRunFile(runsDir, url.pathname);
        if (!file) return json(response, 404, { error: 'not found' });
        response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(readFileSync(file));
        return;
      }
      json(response, 404, { error: 'not found' });
    })().catch((error: unknown) => {
      if (!response.headersSent) json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolveListen());
  });

  const bound = server.address();
  return {
    url: `http://localhost:${typeof bound === 'object' && bound ? bound.port : options.port}`,
    async close() {
      for (const client of clients) client.end();
      await new Promise((resolveClose) => server.close(resolveClose));
      if (shop) await shop.stop();
    },
  };
}

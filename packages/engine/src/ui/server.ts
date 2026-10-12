import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { Intent } from '@hackwave/contracts';
import { describeEvent } from '../console';
import type { EngineEvent } from '../events';
import { exploreIntent, outcomeLine, type ExploreResult } from '../explore';
import { lintIntentText } from '../intent-lint';
import { locatorCacheFile } from '../locator-cache';
import { findRepoRoot } from '../paths';
import { planCacheFile } from '../plan-cache';
import { healerLine } from '../report';
import { loadProjects, projectFor } from '../projects';
import { exploreGoal, isVerified, runGoal, runIntent, SetupError, type RunResult } from '../run';
import { freePort, resetStore, startPrivateShop, type PrivateShop } from '../shop-process';
import { fetchCatalog, typedIntent } from '../typed-goal';
import { renderPage } from './page';
import { SITES, serveSite } from '../../../../apps/demo-sites/serve.mjs';

export type Version = 'v1' | 'v2' | 'v2-broken' | 'v2-wrong-total';

/** The demo shop's versions as the page shows them: a short code, a name, and what is different about it. */
export const VERSION_INFO: Record<Version, { code: string; name: string; detail: string }> = {
  v1: { code: 'A', name: 'The original', detail: 'Cart, checkout, shipping, payment, place order' },
  v2: { code: 'B', name: 'The redesign', detail: 'Buttons renamed, a phone field added, payment on its own screen' },
  'v2-broken': { code: 'B1', name: 'Redesign with a backend bug', detail: 'Says the order is confirmed, saves nothing' },
  'v2-wrong-total': { code: 'B2', name: 'Redesign with a pricing bug', detail: 'Saves the order at the wrong total' },
};

export const VERSIONS: Record<Version, string> = Object.fromEntries(
  Object.entries(VERSION_INFO).map(([version, info]) => [version, `Version ${info.code}: ${info.name.toLowerCase()}`]),
) as Record<Version, string>;

export type SiteId = 'shopsphere' | 'harbor-pine';
export type SiteVersion = 'v1' | 'v2' | 'v3';

/** The demo sites (apps/demo-sites) as projects: their versions, and the goal each opens with. */
export const SITE_PROJECTS: Record<SiteId, { name: string; detail: string; defaultGoal: string; examples: string[]; versions: Record<SiteVersion, { code: string; name: string; detail: string }> }> = {
  shopsphere: {
    name: 'ShopSphere store',
    detail: 'Checked against its browser storage',
    defaultGoal: 'Buy the Cloud Wireless Headphones',
    examples: ['Buy the Studio Table Lamp', 'Buy 2 Everyday Ceramic Mugs'],
    versions: {
      v1: { code: 'V1', name: 'The original store', detail: 'One page: products, cart and checkout' },
      v2: { code: 'V2', name: 'The redesign', detail: 'Cart drawer, checkout dialog, city, postal code and consent' },
      v3: { code: 'V3', name: 'Redesign with a storage bug', detail: 'Confirms the order, saves nothing' },
    },
  },
  'harbor-pine': {
    name: 'Harbor & Pine hotel',
    detail: 'Checked against its browser storage',
    defaultGoal: 'Book the Harbor Suite',
    examples: ['Book the Coastal King', 'Book the Garden Twin'],
    versions: {
      v1: { code: 'V1', name: 'The original booking page', detail: 'One page: dates, rooms and the guest form' },
      v2: { code: 'V2', name: 'The redesign', detail: 'New look, room cards and a booking dialog' },
      v3: { code: 'V3', name: 'Redesign with a storage bug', detail: 'Confirms the reservation, saves nothing' },
    },
  },
};

/** The guided demo preset: one sentence, four runs, one address. */
export const GUIDED_STEPS: readonly { version: Version; fresh: boolean; title: string; say: string }[] = [
  { version: 'v1', fresh: true, title: 'Version A, planned from the sentence', say: 'Only the goal was typed. It reads the page, plans the clicks and checks the real order store.' },
  { version: 'v2', fresh: false, title: 'Version B at the same address', say: 'Renamed buttons, a new flow, a new required field. It heals, passes, and says what changed.' },
  { version: 'v2-broken', fresh: false, title: 'Version B with the backend bug', say: 'The page says confirmed; the store has nothing. It stays red.' },
  { version: 'v2', fresh: false, title: 'Version B again', say: 'Healing is a one-time cost: this run needs no AI at all.' },
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

/** One planned run of a batch: a shop version, or the website. */
interface PlannedRun {
  /** A demo shop version, a demo site version, or null for a website. */
  version: string | null;
  code: string;
  name: string;
  fresh: boolean;
}

/** A test as the tester started it: one goal on one or more versions of the shop, or on one website. */
export type BatchRequest =
  | { project: 'shop'; goal: string; runs: PlannedRun[]; live: boolean; guided: boolean }
  | { project: SiteId; goal: string; runs: PlannedRun[]; live: true; guided: false }
  | { project: 'website'; goal: string; url: string; query: string | null; runs: PlannedRun[]; live: true; guided: false };

/** Parses a POST body into a batch, or says what is wrong with it. `version` (one) is still accepted. */
export function parseBatch(body: Record<string, unknown>, guided: boolean): BatchRequest | string {
  const goal = typeof body.goal === 'string' ? collapse(body.goal) : '';
  if (goal.length < 10 || goal.length > 300) return 'write the goal as one sentence (10 to 300 characters)';
  if (body.project === 'website') {
    let url: URL;
    try {
      url = new URL(typeof body.url === 'string' ? body.url.trim() : '');
    } catch {
      return 'give the website address, e.g. https://www.example.com';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'the website address must start with http:// or https://';
    const query = typeof body.query === 'string' && collapse(body.query) ? collapse(body.query).slice(0, 120) : null;
    return { project: 'website', goal, url: url.toString(), query, live: true, guided: false, runs: [{ version: null, code: 'W', name: url.host, fresh: body.fresh === true }] };
  }
  const fresh = body.fresh === true;
  if (body.project === 'shopsphere' || body.project === 'harbor-pine') {
    const site = SITE_PROJECTS[body.project];
    const asked = Array.isArray(body.versions) ? body.versions : [];
    if (asked.length === 0) return 'pick at least one version';
    if (asked.length > 8) return 'pick at most eight runs';
    const runs: PlannedRun[] = [];
    for (const [index, value] of asked.entries()) {
      if (typeof value !== 'string' || !(value in site.versions)) return `unknown version "${String(value)}" for ${site.name}`;
      const info = site.versions[value as SiteVersion];
      runs.push({ version: value, code: info.code, name: info.name, fresh: fresh && index === 0 });
    }
    return { project: body.project, goal, live: true, guided: false, runs };
  }
  if (guided) {
    return { project: 'shop', goal, live: body.live === true, guided: true, runs: GUIDED_STEPS.map((step) => ({ version: step.version, code: VERSION_INFO[step.version].code, name: step.title, fresh: step.fresh })) };
  }
  const asked = Array.isArray(body.versions) ? body.versions : [typeof body.version === 'string' ? body.version : 'v1'];
  if (asked.length === 0) return 'pick at least one version';
  if (asked.length > 8) return 'pick at most eight runs';
  const runs: PlannedRun[] = [];
  for (const [index, value] of asked.entries()) {
    if (typeof value !== 'string' || !(value in VERSION_INFO)) return `unknown version "${String(value)}"`;
    const version = value as Version;
    runs.push({ version, code: VERSION_INFO[version].code, name: VERSION_INFO[version].name, fresh: fresh && index === 0 });
  }
  return { project: 'shop', goal, live: body.live === true, guided: false, runs };
}

/** One step as the run resolved it: which rung found its control (1 saved spot, 2 name match, 3 fast AI, 5 re-plan). */
interface StepTrace {
  milestone: string;
  stepKey: string;
  rung: number;
  action: string;
  target: string;
  planned: string | null;
}

/**
 * The web app: pick a project and versions, type a goal, and watch the engine plan, act, heal and verify, then compare
 * the versions. It runs the same engine as the CLI, against its own shop at one address (or a website, unverified).
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
  const batches: Record<string, unknown>[] = [];
  let shop: PrivateShop | null = null;
  let deployed: Version | null = null;
  let busy = false;
  let batchCount = 0;
  const siteServers = new Map<string, Server>();

  const send = (message: Record<string, unknown>) => {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of clients) client.write(data);
  };
  const liveAvailable = () => Boolean(process.env.LLM_API_KEY) && process.env.LLM_API_KEY !== 'replace-me';
  const state = () => ({
    type: 'state',
    address,
    deployed,
    deployedCode: deployed ? VERSION_INFO[deployed].code : null,
    busy,
    defaultGoal,
    examples,
    versions: VERSION_INFO,
    guided: GUIDED_STEPS.map((step) => ({ version: step.version, code: VERSION_INFO[step.version].code, title: step.title, say: step.say })),
    liveAvailable: liveAvailable(),
    projects: [
      { id: 'shop', name: 'HackWave demo shop', detail: 'Checked against its order store', defaultGoal, examples, versions: VERSION_INFO },
      ...(Object.entries(SITE_PROJECTS) as [SiteId, (typeof SITE_PROJECTS)[SiteId]][]).map(([id, site]) => ({
        id,
        name: site.name,
        detail: site.detail,
        defaultGoal: site.defaultGoal,
        examples: site.examples,
        versions: site.versions,
        ports: SITES[id].ports,
      })),
    ],
    batches,
  });
  const setBusy = (value: boolean) => {
    busy = value;
    send({ type: 'busy', busy });
  };
  const runUrl = (runDir: string, file: string) => `/runs/${encodeURIComponent(basename(runDir))}/${file.split('/').map(encodeURIComponent).join('/')}`;

  async function deploy(version: Version): Promise<string> {
    if (deployed !== version || !shop) {
      if (shop) await shop.stop();
      shop = null;
      deployed = null;
      send({ type: 'line', tone: 'warn', text: `▶ deploying Version ${VERSION_INFO[version].code} (${VERSION_INFO[version].name.toLowerCase()}) to ${address} ...` });
      shop = await startPrivateShop(root, version, shopPort);
      deployed = version;
      send({ ...state(), type: 'state' });
    }
    return shop.origin;
  }

  /** Streams each event's log lines and keeps the per-step trace the comparison table is built from. */
  const tracer = () => {
    const steps: StepTrace[] = [];
    const skipped: string[] = [];
    const onEvent = (event: EngineEvent) => {
      for (const line of describeEvent(event)) send({ type: 'line', ...line });
      const e = event as EngineEvent & Record<string, unknown>;
      if (e.type === 'resolved' && typeof e.stepKey === 'string') {
        steps.push({
          milestone: e.stepKey.split('.')[0] ?? e.stepKey,
          stepKey: e.stepKey,
          rung: Number(e.rung),
          action: String(e.action),
          target: String(e.target),
          planned: Number(e.rung) > 1 ? String(e.planned) : null,
        });
      }
      if (e.type === 'milestone_skipped' && typeof e.milestoneKey === 'string') skipped.push(e.milestoneKey);
      if (e.type === 'milestone_started' && typeof e.milestoneKey === 'string') send({ type: 'milestone', key: e.milestoneKey });
    };
    return { steps, skipped, onEvent };
  };

  type Trace = ReturnType<typeof tracer>;
  interface EntryBase {
    index: number;
    code: string;
    name: string;
    version: Version | null;
  }

  /** A result card for a verified run: the verdict, its checks, and the evidence. */
  const verifiedEntry = (result: RunResult, base: EntryBase, mode: string, trace: Trace) => {
    const { verdict } = result;
    const finalShot = join(result.runDir, 'evidence', 'final.png');
    return {
      ...base,
      color: verdict.color,
      kind: verdict.kind,
      summary: result.summary,
      whatChanged: result.whatChanged,
      healer: healerLine(verdict),
      claimed: verdict.oracle.finalHeading,
      checks: (['state', 'binding', 'alerts'] as const).map((name) => ({ name, status: verdict.oracle[name].status, summary: verdict.oracle[name].summary })),
      heals: verdict.heals.length,
      replans: verdict.replans.length,
      llmCalls: verdict.llmCalls.total,
      llmCached: verdict.llmCalls.cached,
      mode,
      seconds: Math.round(verdict.timings.totalMs / 100) / 10,
      hypothesis: result.explanation && 'hypothesis' in result.explanation ? result.explanation.hypothesis : null,
      steps: trace.steps,
      skipped: trace.skipped,
      shots: result.shots.map((shot) => ({ url: runUrl(result.runDir, shot.file), caption: shot.caption, kind: shot.kind, stepKey: shot.stepKey })),
      finalShot: existsSync(finalShot) ? runUrl(result.runDir, 'evidence/final.png') : null,
      reportUrl: runUrl(result.runDir, 'report.html'),
      at: new Date().toISOString(),
    };
  };

  /** A result card for a run with no source of truth: explore mode, or a site whose data could not be read. */
  const unverifiedEntry = (result: ExploreResult, base: EntryBase, trace: Trace) => ({
    ...base,
    color: 'UNVERIFIED',
    kind: 'explore',
    summary: `Unverified: ${outcomeLine(result)}. ${result.unverifiedReason && !result.unverifiedReason.startsWith('explore mode') ? `${result.unverifiedReason}.` : "Nothing checked the outcome against the site's data."}`,
    whatChanged: [],
    healer: outcomeLine(result),
    claimed: result.finalHeading ?? result.finalTitle,
    checks: [{ name: 'state', status: 'skipped', summary: result.unverifiedReason ?? 'no source of truth was read' }],
    heals: result.shots.filter((shot) => shot.kind === 'healed').length,
    replans: result.shots.filter((shot) => shot.kind === 'replanned').length,
    llmCalls: result.llmCalls,
    llmCached: 0,
    mode: 'live',
    seconds: null,
    hypothesis: null,
    steps: trace.steps,
    skipped: trace.skipped,
    shots: result.shots.map((shot) => ({ url: runUrl(result.runDir, shot.file), caption: shot.caption, kind: shot.kind, stepKey: shot.stepKey })),
    finalShot: result.screenshot ? runUrl(result.runDir, result.screenshot) : null,
    reportUrl: runUrl(result.runDir, 'report.html'),
    at: new Date().toISOString(),
  });

  async function runShop(batchId: string, index: number, request: Extract<BatchRequest, { project: 'shop' }>, planned: PlannedRun): Promise<Record<string, unknown>> {
    const version = planned.version as Version;
    const origin = await deploy(version);
    await resetStore(origin);
    const known = knownIntentFor(root, request.goal);
    // A goal we have recorded answers for replays them (offline); a new sentence is planned by the live model.
    const goal = known?.goal ?? request.goal;
    const base = known ?? checkout;
    if (!base) throw new SetupError('intents/checkout.json is missing: it supplies the test data (card, address, phone)');
    const { intent, notes } = typedIntent(goal, base.inputs, await fetchCatalog(origin));
    const file = join(runsDir, 'typed', `${intent.id}.json`);
    mkdirSync(join(runsDir, 'typed'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(intent, null, 2)}\n`);
    const mode = request.live || !known ? 'live' : 'replay';
    // The recordings cover one path: the recorded goal planned from scratch on the first version, then onwards. Steps a
    // live run saved for the same goal would send replay down questions nobody recorded, so a replayed test always
    // starts from scratch.
    const fresh = planned.fresh || (index === 0 && mode === 'replay');
    if (fresh) for (const cache of [planCacheFile(root, intent.id), locatorCacheFile(root, intent.id)]) rmSync(cache, { force: true });
    send({ type: 'run', batchId, index, code: planned.code, name: planned.name, goal, target: address, mode, fresh, notes });
    const trace = tracer();
    const result = await runIntent({ intentFile: file, target: origin, headed: options.headed, slowMo: options.slowMo, quiet: true, envOverride: { LLM_MODE: mode }, onEvent: trace.onEvent });
    return verifiedEntry(result, { index, code: planned.code, name: planned.name, version }, mode, trace);
  }

  async function runWebsite(batchId: string, request: Extract<BatchRequest, { project: 'website' }>): Promise<Record<string, unknown>> {
    if (!liveAvailable()) throw new SetupError('a website is planned by the live model: put LLM_API_KEY (and the models) in .env');
    const origin = new URL(request.url).origin;
    const base: EntryBase = { index: 0, code: 'W', name: new URL(request.url).host, version: null };
    const fresh = request.runs[0]?.fresh ?? false;
    const forget = (id: string) => {
      if (fresh) for (const cache of [planCacheFile(root, id), locatorCacheFile(root, id)]) rmSync(cache, { force: true });
    };
    const trace = tracer();

    // An address a project in projects/ claims has a source of truth: run the goal as a verified test. If its data
    // cannot be read after all, runGoal carries on unverified and says why.
    const project = projectFor(loadProjects(root), origin);
    if (project) {
      const store = Object.keys(project.stores)[0] ?? 'orders';
      const { intent, notes } = typedIntent(request.goal, project.inputs ?? checkout?.inputs ?? {}, await fetchCatalog(origin, fetch, project.catalog), store);
      // Each project keeps its own learned steps: the same sentence on two apps must not share a plan.
      intent.id = intent.id.replace(/^typed-/, `typed-${project.id}-`);
      const file = join(runsDir, 'typed', `${intent.id}.json`);
      mkdirSync(join(runsDir, 'typed'), { recursive: true });
      writeFileSync(file, `${JSON.stringify(intent, null, 2)}\n`);
      forget(intent.id);
      send({ type: 'run', batchId, index: 0, code: 'W', name: base.name, goal: request.goal, target: request.url, mode: 'live', fresh, notes: [`project: ${project.name} (projects/${project.id}.json)`, ...notes] });
      const result = await runGoal({ intentFile: file, target: request.url, headed: options.headed, slowMo: options.slowMo, quiet: true, envOverride: { LLM_MODE: 'live' }, onEvent: trace.onEvent });
      return isVerified(result) ? verifiedEntry(result, base, 'live', trace) : unverifiedEntry(result, base, trace);
    }

    const intent = exploreIntent(request.goal, request.query ? { query: request.query } : {});
    forget(intent.id);
    send({ type: 'run', batchId, index: 0, code: 'W', name: base.name, goal: request.goal, target: request.url, mode: 'live', fresh, notes: [] });
    const result = await exploreGoal({ intent, target: request.url, headed: options.headed, slowMo: options.slowMo, quiet: true, envOverride: { LLM_MODE: 'live' }, onEvent: trace.onEvent });
    return unverifiedEntry(result, base, trace);
  }

  /**
   * The demo site version at its fixed port (the port its project file matches): reused when something already serves it
   * there (pnpm sites), started by the app otherwise.
   */
  async function ensureSite(site: SiteId, version: SiteVersion): Promise<string> {
    const port = SITES[site].ports[version];
    const url = `http://localhost:${port}`;
    const answers = await fetch(url, { signal: AbortSignal.timeout(2000) }).then((response) => response.ok).catch(() => false);
    if (answers) return url;
    try {
      siteServers.set(`${site}:${version}`, await serveSite(site, version, port));
    } catch (error) {
      throw new SetupError(`${SITE_PROJECTS[site].name} ${version} needs port ${port}, which another program holds (${error instanceof Error ? error.message : String(error)})`, { cause: error });
    }
    send({ type: 'line', tone: 'warn', text: `▶ serving ${SITE_PROJECTS[site].name} ${version} at ${url} ...` });
    return url;
  }

  async function runSite(batchId: string, index: number, request: Extract<BatchRequest, { project: SiteId }>, planned: PlannedRun): Promise<Record<string, unknown>> {
    if (!liveAvailable()) throw new SetupError(`${SITE_PROJECTS[request.project].name} is tested with the live model: put LLM_API_KEY (and the models) in .env`);
    const version = planned.version as SiteVersion;
    const target = await ensureSite(request.project, version);
    const project = loadProjects(root).find((candidate) => candidate.id === request.project);
    if (!project) throw new SetupError(`projects/${request.project}.json is missing`);
    const store = Object.keys(project.stores)[0] ?? 'orders';
    const { intent, notes } = typedIntent(request.goal, project.inputs ?? {}, await fetchCatalog(target, fetch, project.catalog), store);
    // Each project keeps its own learned steps: the same sentence on two apps must not share a plan.
    intent.id = intent.id.replace(/^typed-/, `typed-${project.id}-`);
    const file = join(runsDir, 'typed', `${intent.id}.json`);
    mkdirSync(join(runsDir, 'typed'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(intent, null, 2)}\n`);
    if (planned.fresh) for (const cache of [planCacheFile(root, intent.id), locatorCacheFile(root, intent.id)]) rmSync(cache, { force: true });
    send({ type: 'run', batchId, index, code: planned.code, name: planned.name, goal: request.goal, target, mode: 'live', fresh: planned.fresh, notes: [`project: ${project.name} (projects/${project.id}.json)`, ...notes] });
    const trace = tracer();
    const result = await runIntent({ intentFile: file, target, headed: options.headed, slowMo: options.slowMo, quiet: true, envOverride: { LLM_MODE: 'live' }, onEvent: trace.onEvent });
    return verifiedEntry(result, { index, code: planned.code, name: planned.name, version: null }, 'live', trace);
  }

  async function runBatch(request: BatchRequest): Promise<void> {
    batchCount += 1;
    const id = `b${batchCount}`;
    const batch: Record<string, unknown> & { runs: Record<string, unknown>[] } = {
      id,
      goal: request.goal,
      project: request.project,
      target: request.project === 'website' ? request.url : request.project === 'shop' ? address : `http://localhost:${SITES[request.project].ports.v1}`,
      projectName: request.project === 'website' ? 'Website' : request.project === 'shop' ? 'HackWave demo shop' : SITE_PROJECTS[request.project].name,
      // Where the test ran, in the page's words.
      targetLabel:
        request.project === 'website'
          ? `Website: ${request.url} (unverified)`
          : request.project === 'shop'
            ? `HackWave demo shop at ${address}, one address, redeployed for each version`
            : `${SITE_PROJECTS[request.project].name}: ${request.runs.map((run) => `${run.code} at localhost:${SITES[request.project as SiteId].ports[run.version as SiteVersion]}`).join(', ')}`,
      guided: request.guided,
      plan: request.runs.map((run) => ({ code: run.code, name: run.name, version: run.version })),
      runs: [],
      done: false,
      error: null,
      startedAt: new Date().toISOString(),
    };
    batches.unshift(batch);
    send({ type: 'batch', batch });
    try {
      if (request.project === 'website') {
        const entry = await runWebsite(id, request);
        batch.runs.push(entry);
        send({ type: 'result', batchId: id, entry });
      } else if (request.project !== 'shop') {
        for (const [index, planned] of request.runs.entries()) {
          const entry = await runSite(id, index, request, planned);
          batch.runs.push(entry);
          send({ type: 'result', batchId: id, entry });
        }
      } else {
        for (const [index, planned] of request.runs.entries()) {
          const entry = await runShop(id, index, request, planned);
          batch.runs.push(entry);
          send({ type: 'result', batchId: id, entry });
        }
      }
    } catch (error) {
      batch.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      batch.done = true;
      send({ type: 'batch_done', batchId: id, error: batch.error });
    }
  }

  async function guard(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hint = /needs a model|not configured|LLM_API_KEY|live model/i.test(message)
        ? 'A new sentence or a website is planned by the live model: put LLM_API_KEY (and the models) in .env, or use the recorded goal on the demo shop, which runs offline.'
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
        const parsed = parseBatch(body, url.pathname === '/api/demo' || body.guided === true);
        if (typeof parsed === 'string') return json(response, 400, { error: parsed });
        json(response, 202, { started: true });
        void guard(() => runBatch(parsed));
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
      await Promise.all([...siteServers.values()].map((site) => new Promise((resolveClose) => site.close(resolveClose))));
    },
  };
}

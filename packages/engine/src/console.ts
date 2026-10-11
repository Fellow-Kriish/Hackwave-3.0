import type { EngineEvent } from './events';

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (open: string) => (text: string) => (useColor ? `\x1b[${open}m${text}\x1b[0m` : text);

export const bold = paint('1');
export const dim = paint('90');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');

const seconds = (ms: unknown) => `${(Number(ms) / 1000).toFixed(1)} s`;

/** How a line reads: the console colours it, the web app styles it. */
export type Tone = 'plain' | 'dim' | 'info' | 'heading' | 'warn' | 'bad' | 'good';

export interface EventLine {
  text: string;
  tone: Tone;
}

const TONE_PAINT: Record<Tone, (text: string) => string> = {
  plain: (text) => text,
  dim,
  info: cyan,
  heading: bold,
  warn: yellow,
  bad: red,
  good: green,
};

/** The lines one event reads as, for the console stream and the web app alike. Most events are one line; some none. */
export function describeEvent(event: EngineEvent): EventLine[] {
  const e = event as EngineEvent & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: EventLine[] = [];
  const line = (tone: Tone, text: string) => out.push({ text, tone });
  switch (e.type) {
    case 'run_started':
      line('heading', `run ${e.intentId} on ${e.target}`);
      line('dim', `plan ${e.plan} (${e.planSource}) · budgets ${e.budgets.maxActions} actions, ${seconds(e.budgets.runMs)} per run, ${seconds(e.budgets.stepMs)} per step`);
      break;
    case 'plan_mismatch':
      line('warn', `note: ${e.message}`);
      break;
    case 'llm_settings':
      if (e.used || e.mode !== 'replay') line('dim', `llm: ${e.mode}${e.pinnedToManifest ? ' (pinned to runs/llm-cache/manifest.json)' : ''} · strong ${e.strong} · fast ${e.fast}`);
      break;
    case 'plan_cache_miss':
      line('dim', `plan: ${e.reason}; the planner will write one`);
      break;
    case 'llm_call':
      line(
        e.failed ? 'bad' : 'info',
        `  [llm] ${e.stage} · ${e.provider} · ${e.model} · ${e.cacheHit ? 'from cache' : `${e.tokensIn}→${e.tokensOut} tokens`} · ${seconds(e.ms)}${e.attempts > 1 ? ` · ${e.attempts} attempts` : ''}${e.failed ? ` · invalid: ${e.failed}` : ''}`,
      );
      if (e.retried) line('warn', `        first reply rejected, retried once: ${e.retried}`);
      break;
    case 'planned':
      line('plain', `plan: ${(e.milestones as { key: string; terminal: boolean }[]).map((milestone) => `${milestone.key}${milestone.terminal ? ' (terminal)' : ''}`).join(' → ')}`);
      break;
    case 'expanded':
      line('dim', `  expanded ${(e.milestones as string[]).join(', ')} on ${e.path}: ${e.steps} step(s)`);
      break;
    case 'plan_cached':
      line('dim', `plan cached in ${e.file}`);
      break;
    case 'verifier_baseline':
      line('dim', `verifier: baseline ${e.count} record(s), max id ${e.maxId ?? 'none'}`);
      break;
    case 'navigated':
      line('dim', `opened ${e.url}`);
      break;
    case 'settle_timeout':
      line('warn', `  settle gate gave up after ${e.waitedMs} ms (${e.label}); proceeding`);
      break;
    case 'milestone_started':
      line('plain', '');
      line('heading', `▸ ${e.milestoneKey}${e.terminal ? ' (terminal)' : ''}  ${e.description}`);
      break;
    case 'milestone_skipped':
      line('plain', '');
      line('good', `✓ ${e.milestoneKey} already done, skipped (${e.detail})`);
      break;
    case 'milestone_reordered':
      line('plain', '');
      line('warn', `↷ ${e.milestoneKey} before ${e.instead}: ${e.detail}`);
      break;
    case 'replan_started':
      line('warn', `  [rung 5] re-planning milestone ${e.milestoneKey} from ${e.stepKey}, attempt ${e.attempt} of ${e.maxAttempts}`);
      break;
    case 'replanned':
      line('warn', `  re-planned milestone ${e.milestoneKey}: ${(e.added as string[]).join('; ')}${e.more ? '; continues on the next screen' : ''}, attempt ${e.attempt} of ${e.maxAttempts}`);
      line('dim', `      ${e.why}`);
      break;
    case 'resolved':
      line(e.rung === 1 ? 'info' : 'warn', `  [rung ${e.rung}] resolved ${e.stepKey} via rung ${e.rung}: ${e.action} ${e.target}${e.rung > 1 ? ` (planned ${e.planned})` : ''} (${e.ms} ms)`);
      break;
    case 'unresolved':
      line('bad', `  could not resolve ${e.stepKey}: ${e.target}`);
      for (const failure of e.failures as string[]) line('bad', `      ${failure}`);
      break;
    case 'healed': {
      const flags = Object.entries(e.validation as Record<string, boolean>)
        .filter(([, ok]) => ok)
        .map(([flag]) => flag)
        .join(', ');
      const change = e.moved ? `${e.fromText} ${e.moved}` : `${e.fromText} became ${e.toText}`;
      line('warn', `  healed ${e.stepKey}: ${change}, rung ${e.rung}, validated ${flags} (${seconds(e.ms)})`);
      break;
    }
    case 'heal_rejected':
      line('bad', `  heal rejected for ${e.stepKey}: ${e.target} (rung ${e.rung}) acted without effect: ${e.detail}`);
      break;
    case 'locators_saved':
      line('dim', `locator cache updated: ${e.file} (${(e.updated as string[]).length} entr${(e.updated as string[]).length === 1 ? 'y' : 'ies'})`);
      break;
    case 'locator_cache_ignored':
      line('warn', `note: ignoring ${e.file}: ${e.reason}`);
      break;
    case 'terminal_attempted':
      line('warn', `  ⚑ terminal action ${e.stepKey}: runs once, then straight to the verifier`);
      break;
    case 'action':
      line('dim', `      ${e.action}${e.inputRef ? ` ← ${e.inputRef}` : ''} done (${e.ms} ms) · ${e.budget.actions}/${e.budget.maxActions} actions · ${seconds(e.budget.elapsedMs)} of ${seconds(e.budget.runMs)}`);
      break;
    case 'progress':
      if (!e.ok) line('bad', `      ✗ no progress: ${e.detail}`);
      break;
    case 'milestone_done':
      line(e.holds ? 'good' : 'warn', e.holds ? `  ✓ ${e.milestoneKey} complete (${e.detail})` : `  ~ ${e.milestoneKey} ran; completion unconfirmed (${e.detail})`);
      break;
    case 'healer_done':
      line(
        e.believed ? 'plain' : 'warn',
        e.believed ? `  healer: believes done at step ${e.atStep} (${e.stepKey}): ${e.detail}` : `  healer: does not believe done after step ${e.atStep} (${e.stepKey}): ${e.detail}`,
      );
      break;
    case 'environment_error':
      line('bad', `  ! ${e.message}`);
      break;
    case 'blocked_request':
      line('dim', `  blocked a request outside the app: ${e.url}`);
      break;
    case 'dialog_dismissed':
      line('dim', `  dismissed a ${e.dialogType} dialog`);
      break;
    case 'refused':
      line('bad', `  refused ${e.stepKey}: ${e.message}`);
      break;
    case 'stopped':
      line(e.outcome === 'environment' ? 'warn' : 'bad', `  stopped (${e.outcome}): ${e.message}`);
      break;
    case 'verifier_result':
      line('plain', '');
      for (const name of ['state', 'binding', 'alerts'] as const) {
        const check = e[name] as { status: string; summary: string };
        line(check.status === 'pass' ? 'good' : check.status === 'fail' ? 'bad' : check.status === 'error' ? 'warn' : 'dim', `verifier: ${name} ${check.status}: ${check.summary}`);
      }
      break;
    default:
      break;
  }
  return out;
}

/** The console stream: one line per event as it happens. The JSON line is already on disk when this runs. */
export function printEvent(event: EngineEvent): void {
  for (const { text, tone } of describeEvent(event)) console.log(TONE_PAINT[tone](text));
}

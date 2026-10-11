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

/** The console stream: one line per event as it happens. The JSON line is already on disk when this runs. */
export function printEvent(event: EngineEvent): void {
  const e = event as EngineEvent & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const line = (text: string) => console.log(text);
  switch (e.type) {
    case 'run_started':
      line(bold(`run ${e.intentId} on ${e.target}`));
      line(dim(`plan ${e.plan} (${e.planSource}) · budgets ${e.budgets.maxActions} actions, ${seconds(e.budgets.runMs)} per run, ${seconds(e.budgets.stepMs)} per step`));
      break;
    case 'plan_mismatch':
      line(yellow(`note: ${e.message}`));
      break;
    case 'llm_settings':
      if (e.used || e.mode !== 'replay') {
        line(dim(`llm: ${e.mode}${e.pinnedToManifest ? ' (pinned to runs/llm-cache/manifest.json)' : ''} · strong ${e.strong} · fast ${e.fast}`));
      }
      break;
    case 'plan_cache_miss':
      line(dim(`plan: ${e.reason}; the planner will write one`));
      break;
    case 'llm_call':
      line(
        cyan(`  [llm] ${e.stage} · ${e.provider} · ${e.model}`) +
          dim(` · ${e.cacheHit ? 'from cache' : `${e.tokensIn}→${e.tokensOut} tokens`} · ${seconds(e.ms)}${e.attempts > 1 ? ` · ${e.attempts} attempts` : ''}`) +
          (e.failed ? red(` · invalid: ${e.failed}`) : ''),
      );
      if (e.retried) line(yellow(`        first reply rejected, retried once: ${e.retried}`));
      break;
    case 'planned':
      line(
        `plan: ${(e.milestones as { key: string; terminal: boolean }[]).map((milestone) => `${milestone.key}${milestone.terminal ? ' (terminal)' : ''}`).join(' → ')}`,
      );
      break;
    case 'expanded':
      line(dim(`  expanded ${(e.milestones as string[]).join(', ')} on ${e.path}: ${e.steps} step(s)`));
      break;
    case 'plan_cached':
      line(dim(`plan cached in ${e.file}`));
      break;
    case 'verifier_baseline':
      line(dim(`verifier: baseline ${e.count} record(s), max id ${e.maxId ?? 'none'}`));
      break;
    case 'navigated':
      line(dim(`opened ${e.url}`));
      break;
    case 'settle_timeout':
      line(yellow(`  settle gate gave up after ${e.waitedMs} ms (${e.label}); proceeding`));
      break;
    case 'milestone_started':
      line(`\n${bold(`▸ ${e.milestoneKey}`)}${e.terminal ? yellow(' (terminal)') : ''} ${dim(e.description)}`);
      break;
    case 'resolved': {
      const tag = e.rung === 1 ? cyan(`[rung 1]`) : yellow(`[rung ${e.rung}]`);
      const planned = e.rung > 1 ? dim(` (planned ${e.planned})`) : '';
      line(`  ${tag} resolved ${e.stepKey} via rung ${e.rung}: ${e.action} ${e.target}${planned} (${e.ms} ms)`);
      break;
    }
    case 'unresolved':
      line(red(`  could not resolve ${e.stepKey}: ${e.target}`));
      for (const failure of e.failures as string[]) line(red(`      ${failure}`));
      break;
    case 'healed': {
      const flags = Object.entries(e.validation as Record<string, boolean>)
        .filter(([, ok]) => ok)
        .map(([flag]) => flag)
        .join(', ');
      const change = e.moved ? `${e.fromText} ${e.moved}` : `${e.fromText} became ${e.toText}`;
      line(yellow(`  healed ${e.stepKey}: ${change}, rung ${e.rung}, validated ${flags} (${seconds(e.ms)})`));
      break;
    }
    case 'heal_rejected':
      line(red(`  heal rejected for ${e.stepKey}: ${e.target} (rung ${e.rung}) acted without effect: ${e.detail}`));
      break;
    case 'locators_saved':
      line(dim(`locator cache updated: ${e.file} (${(e.updated as string[]).length} entr${(e.updated as string[]).length === 1 ? 'y' : 'ies'})`));
      break;
    case 'locator_cache_ignored':
      line(yellow(`note: ignoring ${e.file}: ${e.reason}`));
      break;
    case 'terminal_attempted':
      line(yellow(`  ⚑ terminal action ${e.stepKey}: runs once, then straight to the verifier`));
      break;
    case 'action':
      line(
        dim(`      ${e.action}${e.inputRef ? ` ← ${e.inputRef}` : ''} done (${e.ms} ms) · ${e.budget.actions}/${e.budget.maxActions} actions · ${seconds(e.budget.elapsedMs)} of ${seconds(e.budget.runMs)}`),
      );
      break;
    case 'progress':
      if (!e.ok) line(red(`      ✗ no progress: ${e.detail}`));
      break;
    case 'milestone_done':
      line(e.holds ? green(`  ✓ ${e.milestoneKey} complete (${e.detail})`) : yellow(`  ~ ${e.milestoneKey} ran; completion unconfirmed (${e.detail})`));
      break;
    case 'healer_done':
      line(
        e.believed
          ? `  healer: believes done at step ${e.atStep} (${e.stepKey}): ${e.detail}`
          : yellow(`  healer: does not believe done after step ${e.atStep} (${e.stepKey}): ${e.detail}`),
      );
      break;
    case 'environment_error':
      line(red(`  ! ${e.message}`));
      break;
    case 'blocked_request':
      line(dim(`  blocked a request outside the app: ${e.url}`));
      break;
    case 'dialog_dismissed':
      line(dim(`  dismissed a ${e.dialogType} dialog`));
      break;
    case 'refused':
      line(red(`  refused ${e.stepKey}: ${e.message}`));
      break;
    case 'stopped':
      line((e.outcome === 'environment' ? yellow : red)(`  stopped (${e.outcome}): ${e.message}`));
      break;
    case 'verifier_result':
      line('');
      for (const name of ['state', 'binding', 'alerts'] as const) {
        const check = e[name] as { status: string; summary: string };
        const color = check.status === 'pass' ? green : check.status === 'fail' ? red : check.status === 'error' ? yellow : dim;
        line(color(`verifier: ${name} ${check.status}: ${check.summary}`));
      }
      break;
    default:
      break;
  }
}

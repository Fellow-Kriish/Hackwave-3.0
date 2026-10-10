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
    case 'resolved':
      line(`  ${cyan(`[rung ${e.rung}]`)} resolved ${e.stepKey} via rung ${e.rung}: ${e.action} ${e.target} (${e.ms} ms)`);
      break;
    case 'unresolved': {
      const flags = Object.entries(e.validation as Record<string, boolean>)
        .map(([flag, ok]) => `${flag} ${ok ? '✓' : '✗'}`)
        .join(', ');
      line(red(`  [rung ${e.rung}] could not resolve ${e.stepKey}: ${e.target} ${e.reason} (${flags})`));
      break;
    }
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
      line(e.holds ? green(`  ✓ ${e.milestoneKey} complete (${e.detail})`) : red(`  ✗ ${e.milestoneKey} incomplete: ${e.detail}`));
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

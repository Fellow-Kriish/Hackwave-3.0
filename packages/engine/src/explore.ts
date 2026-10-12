import { IntentSchema, type HealerDone, type Inputs, type Intent, type Plan, type Reason, type RunOutcome } from '@hackwave/contracts';
import { bold, dim, green, yellow } from './console';
import { idFromGoal } from './init';

/**
 * Explore mode, and typed goals on sites with no readable data: the engine plans, acts and heals as usual, but no
 * verifier reads the app's data. A run that completes and believes it reached the goal passes, quietly tagged
 * "unverified": the result rests on the page alone. It is never GREEN, which stays for checked-against-data passes.
 */
export interface ExploreResult {
  runDir: string;
  outcome: RunOutcome;
  reason: Reason | null;
  healerBelievedDone: HealerDone;
  actions: number;
  milestones: string[];
  finalUrl: string;
  finalTitle: string;
  finalHeading: string | null;
  llmCalls: number;
  screenshot: string | null;
  /** Screens at every change or failure (RunShot in run.ts). */
  shots: { file: string; kind: string; stepKey: string | null; caption: string }[];
  /** Why nothing was verified: explore mode, or a site with no readable source of truth. */
  unverifiedReason: string | null;
}

/** Explore runs get more time: real sites are slower than the demo shop and never stop loading ads and beacons. */
const EXPLORE_BUDGETS = { runMs: 180_000, stepMs: 20_000 };

/**
 * The goal as an intent. The schema needs an oracle; explore mode never reads it (no baseline, no verifier), and the
 * placeholder says so in case it is ever printed.
 */
export function exploreIntent(goal: string, inputs: Inputs): Intent {
  return IntentSchema.parse({
    id: `explore-${idFromGoal(goal)}`,
    goal: goal.trim(),
    inputs,
    oracle: {
      state: { store: 'explore-not-checked', expectedNewCount: 1, match: { items: ['explore mode: the outcome is not checked'] } },
      ui: { newRecordIdVisible: false, noAlerts: false },
    },
    budgets: EXPLORE_BUDGETS,
  });
}

/** --input query="water bottle" (repeatable) as intent inputs; keys are lowerCamelCase like every input name. */
export function parseInputs(pairs: readonly string[]): Inputs {
  const inputs: Inputs = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    const key = at > 0 ? pair.slice(0, at).trim() : '';
    if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) throw new Error(`--input needs key=value with a lowerCamelCase key, e.g. --input query="water bottle" (got "${pair}")`);
    inputs[key] = pair.slice(at + 1).trim();
  }
  return inputs;
}

/** Passed (unverified) when every step ran and the engine believes the goal was reached. */
export const passedUnverified = (result: Pick<ExploreResult, 'outcome' | 'healerBelievedDone'>) => result.outcome === 'completed' && result.healerBelievedDone.believed;

export function outcomeLine(result: Pick<ExploreResult, 'outcome' | 'reason' | 'healerBelievedDone'>): string {
  const done = result.healerBelievedDone;
  if (result.outcome === 'completed' && done.believed) return `every step ran; the engine believes the goal was reached at step ${done.atStep} (${done.stepKey})`;
  if (result.outcome === 'completed') return 'every step ran, but the engine is not sure the goal was reached';
  return `stopped (${result.outcome}): ${result.reason?.message ?? 'no reason recorded'}`;
}

export function renderExploreReport(goal: string, target: string, plan: Plan | null, result: ExploreResult): string {
  const lines = [
    passedUnverified(result) ? '# Passed (unverified)' : '# Did not finish (unverified)',
    '',
    `- **Goal:** ${goal}`,
    `- **Site:** ${target}`,
    `- **What happened:** ${outcomeLine(result)}`,
    `- **Final page:** ${result.finalTitle || '(no title)'}${result.finalHeading ? ` · heading "${result.finalHeading}"` : ''}`,
    `- **Final address:** ${result.finalUrl}`,
    `- **Actions:** ${result.actions} · **AI calls:** ${result.llmCalls}`,
    '',
    '## The plan it made',
    '',
  ];
  for (const milestone of plan?.milestones ?? []) {
    lines.push(`- **${milestone.key}**${milestone.terminal ? ' (final action)' : ''}: ${milestone.description}`);
    for (const step of milestone.steps ?? []) {
      const target = 'target' in step && step.target ? ` ${step.target.role} "${step.target.name ?? `{${step.target.nameRef}}`}"` : '';
      lines.push(`  - ${step.action}${target}${'inputRef' in step && step.inputRef ? ` ← ${step.inputRef}` : ''}`);
    }
  }
  if (result.shots.length > 0) {
    lines.push('', '## Where it changed course or failed', '');
    for (const shot of result.shots) lines.push(`- ${shot.caption}`, '', `  ![${shot.caption}](${shot.file})`);
  }
  if (result.screenshot) lines.push('', '## Final screen', '', `![final screen](${result.screenshot})`);
  lines.push(
    '',
    `Unverified: ${result.unverifiedReason ?? 'no source of truth was read'}. The result rests on what the page showed; add a project in projects/ to check it against the app's data.`,
  );
  return `${lines.join('\n')}\n`;
}

export function printExploreBlock(result: ExploreResult): void {
  console.log('');
  console.log(passedUnverified(result) ? `${green(bold('━━ PASSED ━━'))} ${dim('(unverified)')}` : `${yellow(bold('━━ DID NOT FINISH ━━'))} ${dim('(unverified)')}`);
  console.log(`  ${outcomeLine(result)}`);
  console.log(`  final page: ${result.finalTitle || '(no title)'}${result.finalHeading ? ` · "${result.finalHeading}"` : ''}`);
  console.log(`  address: ${result.finalUrl}`);
  console.log(`  ${result.actions} action(s) · ${result.llmCalls} AI call(s) · ${result.shots.length} screenshot(s) at changes or failures`);
  console.log(dim(`  unverified: ${result.unverifiedReason ?? 'no source of truth was read'}`));
  console.log(`  report: ${result.runDir}\\report.md (and report.html${result.screenshot ? `, ${result.screenshot}` : ''})`);
}

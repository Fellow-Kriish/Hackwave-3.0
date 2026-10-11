import { join } from 'node:path';
import type { Plan, RunRecord, Step, Verdict } from '@hackwave/contracts';
import type { EngineConfig } from './config';
import { bold, dim, green, red, yellow } from './console';
import type { Explanation } from './explain';
import type { CachedLocator } from './locator-cache';
import { describeStep } from './step-rules';

/** One locator cache entry this run wrote: what it held before (null when new) and after. */
export interface LocatorChange {
  stepKey: string;
  before: CachedLocator | null;
  after: CachedLocator;
  rung: number;
}

export interface ReportContext {
  config: EngineConfig;
  record: RunRecord;
  /** The intent file as passed to run, for the re-run command. */
  intentFile: string;
  planFile: string;
  planSource: string;
  runDir: string;
  llmMode: string;
  locatorsFile: string;
  /** Step keys whose cache entries this run wrote. */
  locatorsUpdated: string[];
  /** Before and after of each of those entries. */
  locatorChanges: LocatorChange[];
  /** Runs whose earlier heals this run reused on rung 1. */
  reusedHealsFrom: string[];
  /** The plan as loaded (null when the planner wrote it in this run) and as executed. */
  planBefore: Plan | null;
  planAfter: Plan | null;
  /** Whether this run wrote the plan cache. */
  planCached: boolean;
  /** Milestones in the order they started, and those skipped as already done. */
  started: string[];
  skipped: string[];
  expanded: string[];
  replanned: string[];
  /** The RED hypothesis (real bugs only), or why there is none; null when none was asked for. */
  explanation: Explanation | null;
}

const KIND_LABEL: Record<Verdict['kind'], string> = {
  passed: 'passed',
  ui_drift: 'UI drift',
  real_bug: 'real bug',
  unresolvable: 'unresolvable',
  environment: 'environment',
  incomplete: 'incomplete',
};

const CHECKS = ['state', 'binding', 'alerts'] as const;
const CHECK_LABEL = { state: 'state delta', binding: 'UI-to-state binding', alerts: 'no error alerts' } as const;
const RUNG_NAME: Record<number, string> = { 1: 'cached locator', 2: 'attribute similarity', 3: 'fast model', 4: 'vision', 5: 'milestone re-plan' };
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function locatorText(locator: { role: string; name: string; within?: { role: string; name: string } | undefined } | null): string {
  if (!locator) return '(none)';
  return `${locator.role} "${locator.name}"${locator.within ? ` in ${locator.within.role} "${locator.within.name}"` : ''}`;
}

/** A cache entry's locator, input names as {key}. */
function cachedText(locator: CachedLocator): string {
  const name = (box: { name?: string | undefined; nameRef?: string | undefined }) => box.name ?? `{${box.nameRef ?? ''}}`;
  return `${locator.role} "${name(locator)}"${locator.within ? ` in ${locator.within.role} "${name(locator.within)}"` : ''}`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function banner(verdict: Verdict): string {
  return `${verdict.color} · ${KIND_LABEL[verdict.kind]}`;
}

export function healerLine(verdict: Verdict): string {
  const done = verdict.healerBelievedDone;
  if (done.atStep === null) return 'healer stopped before finishing the plan';
  return done.believed
    ? `healer believed done at step ${done.atStep} (${done.stepKey})`
    : `healer did not believe done after step ${done.atStep} (${done.stepKey})`;
}

function failingCheck(verdict: Verdict): (typeof CHECKS)[number] | undefined {
  return CHECKS.find((name) => verdict.oracle[name].status === 'fail');
}

/** One sentence a reader can stop after. */
export function summary(verdict: Verdict, context: Pick<ReportContext, 'planSource'>): string {
  const first = verdict.reasons[0]?.message ?? '';
  switch (verdict.kind) {
    case 'passed':
      return `Passed: the system of record has the new record ${verdict.oracle.newRecordId ?? ''} and it matches; no step needed healing${verdict.llmCalls.total === 0 ? ', and no model was called' : ''}.`;
    case 'ui_drift':
      return `Passed on the system of record after the UI changed: ${verdict.heals.length} heal(s) and ${verdict.replans.length} re-plan(s). ${
        context.planSource === 'hand-written' ? 'The changes are listed below.' : 'The fix is below: review the cache diff and commit it.'
      }`;
    case 'real_bug': {
      const failing = failingCheck(verdict);
      const page = verdict.oracle.finalHeading ? `The page said "${verdict.oracle.finalHeading}"` : 'The run reached its end';
      return `${page}, but the system of record disagrees: ${failing ? verdict.oracle[failing].summary : first}.`;
    }
    case 'unresolvable':
      return `Stopped before the goal and refused to guess: ${first}`;
    case 'environment':
      return `No verdict on the app: the environment failed (${first}). Fix it and run again; CI retries once.`;
    case 'incomplete':
      return `The run did not reach the goal: ${first}`;
  }
}

/** A name as people read it: a changing count or price shows as "…" rather than {n}. */
const readable = (name: string) => name.replace(/\{n\}/g, '…');

/**
 * For AMBER, in plain words: what changed in the app, read off what the run saw (renames, moves, new fields, a new
 * order, rebuilt steps). No model writes it, so nothing in it can be made up.
 */
export function whatChanged(verdict: Verdict, context: Pick<ReportContext, 'planBefore' | 'started' | 'skipped'>): string[] {
  const lines: string[] = [];
  for (const heal of verdict.heals) {
    const from = heal.from;
    if (!from) continue;
    if (heal.moved || locatorText(from) === locatorText(heal.to)) {
      lines.push(`The ${heal.to.role} "${readable(heal.to.name)}" moved to another part of the page${heal.moved ? ` (${heal.moved})` : ''}.`);
    } else {
      lines.push(`The ${from.role} "${readable(from.name)}" is now called "${readable(heal.to.name)}"${heal.to.role === from.role ? '' : ` and is now a ${heal.to.role}`}.`);
    }
  }
  const before = context.planBefore;
  if (before) {
    const inPlanOrder = before.milestones.map((milestone) => milestone.key).filter((key) => context.started.includes(key));
    if (inPlanOrder.join() !== context.started.join()) lines.push(`The flow's order changed: it now goes ${context.started.join(' → ')}; the plan said ${inPlanOrder.join(' → ')}.`);
  }
  if (context.skipped.length > 0) lines.push(`${context.skipped.join(', ')} ${context.skipped.length === 1 ? 'was' : 'were'} already done when the run got there.`);
  const filledBefore = new Set((before?.milestones ?? []).flatMap((milestone) => milestone.steps.flatMap((step) => (step.action === 'fill' || step.action === 'select' ? [step.inputRef] : []))));
  for (const replan of verdict.replans) {
    for (const step of replan.newSteps) {
      if ((step.action === 'fill' || step.action === 'select') && !filledBefore.has(step.inputRef)) {
        lines.push(`The page now asks for a new field, ${step.target.role} "${readable(step.target.name ?? step.inputRef)}" (filled from ${step.inputRef}).`);
      }
    }
    lines.push(`The ${replan.milestoneKey} part of the flow had to be rebuilt from the goal${replan.rationale ? `: ${replan.rationale}` : '.'}`);
  }
  return lines;
}

function whatChangedSection(verdict: Verdict, context: ReportContext): string[] {
  if (verdict.kind !== 'ui_drift') return [];
  const lines = whatChanged(verdict, context);
  if (lines.length === 0) return [];
  return [
    '## What changed',
    '',
    'The app changed since these steps were recorded. In plain words:',
    '',
    ...lines.map((line) => `- ${line}`),
    '',
    'None of it broke the goal: the order reached the system of record with the right item, total and card.',
    '',
  ];
}

function notionsOfDone(verdict: Verdict): string[] {
  const failing = failingCheck(verdict);
  return [
    '## Two notions of done',
    '',
    `**${healerLine(verdict)} — verifier: ${verdict.color}**`,
    '',
    `- Healer (soft, reads only the page): ${healerLine(verdict).replace(/^healer /, '')}`,
    `- Verifier (hard, reads the system of record): ${verdict.color} · ${KIND_LABEL[verdict.kind]}${failing ? `: ${CHECK_LABEL[failing]} failed, ${verdict.oracle[failing].summary}` : ''}`,
    `- Final page: ${verdict.oracle.finalHeading ? `"${verdict.oracle.finalHeading}"` : '(no heading)'} at ${verdict.oracle.finalUrl ?? '(unknown)'}`,
    '',
  ];
}

function hypothesisSection(context: ReportContext): string[] {
  const explanation = context.explanation;
  if (!explanation) return [];
  return [
    '## Hypothesis',
    '',
    'Written by the fast model after the verdict, from the evidence above. It cannot change the verdict.',
    '',
    'hypothesis' in explanation ? `> ${explanation.hypothesis}` : `Skipped: ${explanation.skipped}.`,
    '',
  ];
}

/** The heal diff: before and after locator per step, with the rung that found it and why. */
function healSection(verdict: Verdict, context: ReportContext): string[] {
  if (verdict.heals.length === 0) {
    return context.reusedHealsFrom.length > 0
      ? ['## Heals', '', `None this run. Locators healed earlier by run ${context.reusedHealsFrom.map((run) => `\`${run}\``).join(', ')} resolved on rung 1.`, '']
      : [];
  }
  return [
    '## Heals',
    '',
    '| Step | Before | After | Rung | Validated |',
    '| --- | --- | --- | --- | --- |',
    ...verdict.heals.map(
      (heal) =>
        `| ${heal.stepKey} | ${escapeCell(locatorText(heal.from))} | ${locatorText(heal.from) === locatorText(heal.to) ? 'same locator, element moved (reason below)' : escapeCell(locatorText(heal.to))} | ${heal.rung} | ${Object.entries(heal.validation)
          .filter(([, ok]) => ok)
          .map(([flag]) => flag)
          .join(', ')} |`,
    ),
    '',
    ...verdict.heals.map((heal) => `- \`${heal.stepKey}\`: ${heal.reason}`),
    '',
  ];
}

/** Each rung-5 re-plan: why, and the milestone's replaced steps against the new ones. */
function replanSection(verdict: Verdict): string[] {
  if (verdict.replans.length === 0) return [];
  return [
    '## Re-plans',
    '',
    ...verdict.replans.flatMap((replan) => [
      `### ${replan.milestoneKey}, attempt ${replan.attempt}`,
      '',
      `Why: ${replan.reason}`,
      ...(replan.rationale ? ['', `Re-planner: ${replan.rationale}`] : []),
      '',
      '```diff',
      ...replan.oldSteps.map((step) => `- ${step.key}: ${describeStep(step)}`),
      ...replan.newSteps.map((step) => `+ ${step.key}: ${describeStep(step)}`),
      '```',
      '',
    ]),
  ];
}

/** Line diff by longest common subsequence: "  " kept, "- " removed, "+ " added. */
export function lineDiff(before: readonly string[], after: readonly string[]): string[] {
  const width = after.length + 1;
  const table = new Array<number>((before.length + 1) * width).fill(0);
  const at = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * width + j] = before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push(`  ${before[i]}`);
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) out.push(`- ${before[i++]}`);
    else out.push(`+ ${after[j++]}`);
  }
  while (i < before.length) out.push(`- ${before[i++]}`);
  while (j < after.length) out.push(`+ ${after[j++]}`);
  return out;
}

/** The plan as executed against the plan as loaded: order, skips, and steps per milestone. */
export function planDiff(
  before: Plan | null,
  after: Plan | null,
  run: Pick<ReportContext, 'started' | 'skipped' | 'expanded' | 'replanned'>,
): string[] {
  if (!after) return [];
  const planned = after.milestones.map((milestone) => milestone.key);
  const lines: string[] = [];
  if (!before) {
    lines.push(`The planner wrote this plan in this run (${planned.join(' → ')}); there is no earlier plan to compare with.`);
  } else {
    const inPlanOrder = planned.filter((key) => run.started.includes(key));
    if (inPlanOrder.join() !== run.started.join()) {
      lines.push(`Milestones ran as ${run.started.join(' → ')} (planned ${inPlanOrder.join(' → ')}): each time, the ready milestone that started on the current screen went first.`);
    }
    if (run.skipped.length > 0) lines.push(`Skipped, already done when they came up: ${run.skipped.join(', ')}.`);
    const describe = (step: Step) => `${step.key}: ${describeStep(step)}`;
    for (const milestone of after.milestones) {
      const old = (before.milestones.find((candidate) => candidate.key === milestone.key)?.steps ?? []).map(describe);
      const now = milestone.steps.map(describe);
      if (old.join('\n') === now.join('\n')) continue;
      const how = [run.replanned.includes(milestone.key) ? 're-planned' : '', run.expanded.includes(milestone.key) ? 'expanded on the live screen' : ''].filter(Boolean).join(', ');
      if (lines.length > 0) lines.push('');
      lines.push(`### ${milestone.key}${how ? ` (${how})` : ''}`, '', '```diff', ...lineDiff(old, now), '```');
    }
  }
  return lines.length > 0 ? ['## Plan diff', '', ...lines, ''] : [];
}

/** A pull-request description the engineer can paste: what changed, how it was found, how to check it. */
export function prBlock(
  verdict: Verdict,
  context: Pick<ReportContext, 'intentFile' | 'locatorsFile' | 'planFile'> & Partial<Pick<ReportContext, 'planBefore' | 'started' | 'skipped'>>,
): string[] {
  const changes = whatChanged(verdict, { planBefore: context.planBefore ?? null, started: context.started ?? [], skipped: context.skipped ?? [] });
  return [
    `## Heal UI drift in ${verdict.intentId}`,
    '',
    `The app at ${verdict.target} changed. Run \`${verdict.runId}\` healed the test and the oracle passed on the system of record (state delta, UI-to-state binding, no error alerts), so these changes are checked against the outcome, not guessed.`,
    '',
    ...(changes.length > 0 ? ['**What changed**', '', ...changes.map((line) => `- ${line}`), ''] : []),
    ...(verdict.heals.length > 0
      ? [
          `**Locators** (\`${context.locatorsFile}\`)`,
          '',
          '| Step | Before | After | Found by |',
          '| --- | --- | --- | --- |',
          ...verdict.heals.map(
            (heal) =>
              `| ${heal.stepKey} | ${escapeCell(locatorText(heal.from))} | ${locatorText(heal.from) === locatorText(heal.to) ? 'unchanged; the element moved to another landmark' : escapeCell(locatorText(heal.to))} | rung ${heal.rung}, ${RUNG_NAME[heal.rung] ?? ''} |`,
          ),
          '',
        ]
      : []),
    ...(verdict.replans.length > 0
      ? [
          `**Plan** (\`${context.planFile}\`)`,
          '',
          ...verdict.replans.map((replan) => `- ${replan.milestoneKey}: ${replan.newSteps.map(describeStep).join('; ')}${replan.rationale ? `. ${replan.rationale}` : ''}`),
          '',
        ]
      : []),
    `**Check**: \`pnpm engine run --intent ${context.intentFile} --target ${verdict.target}\` is GREEN with 0 model calls once these files are committed.`,
  ];
}

/** For AMBER: the cache changes the run already wrote, and the PR text. */
function suggestedFix(verdict: Verdict, context: ReportContext): string[] {
  if (verdict.color !== 'AMBER') return [];
  if (context.planSource === 'hand-written') {
    return [
      '## Suggested fix',
      '',
      `Hand-written plan: its heals went to the scratch cache \`${context.locatorsFile}\`, which is never committed, and its re-plans applied to this run only. To keep them, copy the new targets and steps above into the plan file.`,
      '',
    ];
  }
  const locatorLines = context.locatorChanges.flatMap((change) => {
    if (!change.before) return [`+ ${change.stepKey}: ${cachedText(change.after)}  (new entry)`];
    if (cachedText(change.before) === cachedText(change.after)) return [`  ${change.stepKey}: ${cachedText(change.after)}  (same locator; fingerprint updated, the element moved)`];
    return [`- ${change.stepKey}: ${cachedText(change.before)}`, `+ ${change.stepKey}: ${cachedText(change.after)}  (rung ${change.rung})`];
  });
  return [
    '## Suggested fix',
    '',
    'The run already wrote it into the committed caches: review the diff and commit them.',
    '',
    ...(locatorLines.length > 0 ? [`\`${context.locatorsFile}\`:`, '', '```diff', ...locatorLines, '```', ''] : []),
    ...(context.planCached && context.replanned.length > 0 ? [`\`${context.planFile}\`: the re-planned milestones in the plan diff above (${context.replanned.join(', ')}).`, ''] : []),
    '### Pull request text',
    '',
    '````markdown',
    ...prBlock(verdict, context),
    '````',
    '',
  ];
}

function llmLine(verdict: Verdict): string {
  const models = Object.entries(verdict.llmCalls.byModel)
    .map(([model, calls]) => {
      const tokens = verdict.tokens.byModel[model];
      return `${model}: ${calls} call(s), ${tokens?.input ?? 0} in / ${tokens?.output ?? 0} out`;
    })
    .join('; ');
  const cached = verdict.llmCalls.cached > 0 ? ` (${verdict.llmCalls.cached} from cache)` : '';
  return `${verdict.llmCalls.total}${cached}${models ? ` · ${models}` : ''}`;
}

function histogram(verdict: Verdict): string {
  return Object.entries(verdict.rungHistogram)
    .map(([rung, count]) => `rung ${rung}: ${count}`)
    .join(' · ');
}

/**
 * report.md: the verdict and one summary sentence first (for a real bug, both notions of done right after it),
 * then the config in force, the oracle checks, the hypothesis, heals, re-plans, plan diff, suggested fix and PR
 * text, and the run's numbers.
 */
export function renderReport(verdict: Verdict, context: ReportContext): string {
  const { config, record } = context;
  const b = config.budgets;
  const realBug = verdict.kind === 'real_bug';
  const lines = [
    `# ${verdict.color} · ${KIND_LABEL[verdict.kind]}`,
    '',
    `\`${verdict.intentId}\` on ${verdict.target} · run \`${verdict.runId}\` · plan \`${context.planFile}\` (${context.planSource})`,
    '',
    `> ${summary(verdict, context)}`,
    '',
    ...whatChangedSection(verdict, context),
    ...(realBug ? notionsOfDone(verdict) : []),
    '## Config in force',
    '',
    `- Budgets: ${b.maxActions} actions, ${seconds(b.runMs)} per run, ${seconds(b.stepMs)} per step, ${b.maxReplansPerMilestone} re-plans per milestone, ${b.maxLlmCallsPerRun} LLM calls, ${b.maxRung3AttemptsPerStepPerScreen} rung-3 attempt per step per screen`,
    `- Ladder: accept ${config.ladder.similarityAccept}, margin ${config.ladder.similarityMargin}, ${config.ladder.candidatesPerStep} candidates, full tree below ${config.ladder.fullTreeBelowScore}, vision ${config.ladder.visionEnabled ? 'on' : 'off'}`,
    `- Tree: ${config.tree.maxNodes} nodes, ${config.tree.maxTextChars} chars · Settle: ${config.settle.sampleGapMs} ms gap, ${config.settle.maxWaitMs} ms max · Verifier poll: ${config.verifier.pollMs} ms`,
    `- LLM: mode ${context.llmMode}; tiers planner ${config.models.planner}, re-planner ${config.models.replanner}, resolver ${config.models.resolver}, explain ${config.models.explain}; input cap ${config.llm.maxInputTokens} tokens, output cap ${config.llm.maxOutputTokens}`,
    '',
    '## Reasons',
    '',
    ...verdict.reasons.map((reason) => `- **${reason.code}**: ${reason.message}`),
    '',
    ...(realBug ? [] : notionsOfDone(verdict)),
    '## Oracle checks',
    '',
    `Baseline: ${verdict.oracle.baseline.count} record(s), max id ${verdict.oracle.baseline.maxId ?? 'none'}. New record: ${verdict.oracle.newRecordId ?? 'none'}.`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |',
    ...CHECKS.map((name) => `| ${CHECK_LABEL[name]} | ${verdict.oracle[name].status} | ${escapeCell(verdict.oracle[name].summary)} |`),
    '',
    ...hypothesisSection(context),
    ...healSection(verdict, context),
    ...replanSection(verdict),
    ...planDiff(context.planBefore, context.planAfter, context),
    ...suggestedFix(verdict, context),
    '## Run',
    '',
    `- Outcome: ${record.outcome}${record.reason ? ` (${record.reason.code}: ${record.reason.message})` : ''}; terminal action ${record.terminalAttempted ? 'attempted once' : 'never attempted'}`,
    `- Actions: ${record.actions} of ${b.maxActions}; last step \`${record.lastStepKey ?? 'none'}\``,
    `- Rung histogram: ${histogram(verdict)}`,
    `- Heals: ${verdict.heals.length} · Re-plans: ${verdict.replans.length}`,
    `- LLM calls: ${llmLine(verdict)}${context.explanation && 'hypothesis' in context.explanation ? '; plus 1 for the hypothesis, after the verdict' : ''}`,
    `- Time: browser ${seconds(verdict.timings.browserMs)} · LLM ${seconds(verdict.timings.llmMs)} · total ${seconds(verdict.timings.totalMs)}`,
    ...(record.environmentErrors.length > 0 ? ['', 'Environment errors:', '', ...record.environmentErrors.map((error) => `- ${error}`)] : []),
    '',
    '## Step timings',
    '',
    '| Step | Kind | ms |',
    '| --- | --- | --- |',
    ...verdict.timings.steps.map((step) => `| ${step.key} | ${step.kind} | ${step.ms} |`),
    '',
    `Run folder: \`${context.runDir}\``,
    '',
  ];
  return lines.join('\n');
}

/** The final console block: the same story as report.md, short. */
export function printFinalBlock(verdict: Verdict, context: ReportContext): void {
  const color = verdict.color === 'GREEN' ? green : verdict.color === 'AMBER' ? yellow : verdict.color === 'RED' ? red : dim;
  const log = (text: string) => console.log(text);
  log('');
  log(color(bold(`━━ ${banner(verdict)} ━━`)));
  log(color(`  ${summary(verdict, context)}`));
  if (verdict.kind === 'ui_drift') {
    const changes = whatChanged(verdict, context);
    if (changes.length > 0) {
      log(yellow('  what changed:'));
      for (const line of changes) log(yellow(`    · ${line}`));
    }
  }
  for (const reason of verdict.reasons) log(dim(`  ${reason.code}: ${reason.message}`));
  log(`  ${healerLine(verdict)} · verifier: ${verdict.color}`);
  if (verdict.oracle.finalHeading) log(dim(`  final page: "${verdict.oracle.finalHeading}"`));
  log(dim(`  ${histogram(verdict)} · heals ${verdict.heals.length} · re-plans ${verdict.replans.length}`));
  for (const heal of verdict.heals) {
    const after = locatorText(heal.from) === locatorText(heal.to) ? 'same locator, element moved' : locatorText(heal.to);
    log(yellow(`  heal: ${heal.stepKey} ${locatorText(heal.from)} → ${after} (rung ${heal.rung})`));
  }
  for (const replan of verdict.replans) {
    log(yellow(`  re-plan: ${replan.milestoneKey} attempt ${replan.attempt}: ${replan.newSteps.map(describeStep).join('; ')}`));
  }
  if (context.planBefore) {
    const inPlanOrder = context.planBefore.milestones.map((milestone) => milestone.key).filter((key) => context.started.includes(key));
    if (inPlanOrder.join() !== context.started.join()) log(yellow(`  order: ran ${context.started.join(' → ')} (planned ${inPlanOrder.join(' → ')})`));
  }
  if (context.skipped.length > 0) log(dim(`  skipped, already done: ${context.skipped.join(', ')}`));
  if (verdict.heals.length === 0 && context.reusedHealsFrom.length > 0) {
    log(dim(`  locators healed earlier by run ${context.reusedHealsFrom.join(', ')} resolved on rung 1`));
  }
  const explanation = context.explanation;
  if (explanation) log('hypothesis' in explanation ? red(`  hypothesis (fast model, after the verdict): ${explanation.hypothesis}`) : dim(`  hypothesis skipped: ${explanation.skipped}`));
  log(dim(`  plan: ${context.planSource} · LLM calls ${llmLine(verdict)}`));
  log(dim(`  browser ${seconds(verdict.timings.browserMs)} · LLM ${seconds(verdict.timings.llmMs)} · total ${seconds(verdict.timings.totalMs)}`));
  if (verdict.color === 'AMBER' && context.planSource !== 'hand-written') {
    log('');
    log(yellow('  suggested fix: already written to the caches; PR text:'));
    for (const line of prBlock(verdict, context)) log(dim(`  │ ${line}`));
  }
  log(dim(`  report: ${join(context.runDir, 'report.md')} (and report.html)`));
}

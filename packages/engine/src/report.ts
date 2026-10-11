import type { RunRecord, Verdict } from '@hackwave/contracts';
import type { EngineConfig } from './config';
import { bold, dim, green, red, yellow } from './console';

export interface ReportContext {
  config: EngineConfig;
  record: RunRecord;
  planFile: string;
  planSource: string;
  runDir: string;
  llmMode: string;
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

const KIND_LABEL: Record<Verdict['kind'], string> = {
  passed: 'passed',
  ui_drift: 'UI drift',
  real_bug: 'real bug',
  unresolvable: 'unresolvable',
  environment: 'environment',
  incomplete: 'incomplete',
};

const CHECK_LABEL = { state: 'state delta', binding: 'UI-to-state binding', alerts: 'no error alerts' } as const;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

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

function histogram(verdict: Verdict): string {
  return Object.entries(verdict.rungHistogram)
    .map(([rung, count]) => `rung ${rung}: ${count}`)
    .join(' · ');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** report.md: config in force at the top, then the verdict, both notions of done, the oracle and the run. */
export function renderReport(verdict: Verdict, context: ReportContext): string {
  const { config, record } = context;
  const b = config.budgets;
  const lines = [
    `# ${verdict.color} · ${KIND_LABEL[verdict.kind]}`,
    '',
    `\`${verdict.intentId}\` on ${verdict.target} · run \`${verdict.runId}\` · plan \`${context.planFile}\` (${context.planSource})`,
    '',
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
    '## Two notions of done',
    '',
    `- Healer (soft, read from the aria tree): ${healerLine(verdict).replace(/^healer /, '')}`,
    `- Verifier (hard, read from the orders store): ${verdict.color} · ${KIND_LABEL[verdict.kind]}`,
    `- Final page: ${verdict.oracle.finalHeading ? `"${verdict.oracle.finalHeading}"` : '(no heading)'} at ${verdict.oracle.finalUrl ?? '(unknown)'}`,
    '',
    '## Oracle checks',
    '',
    `Baseline: ${verdict.oracle.baseline.count} record(s), max id ${verdict.oracle.baseline.maxId ?? 'none'}. New record: ${verdict.oracle.newRecordId ?? 'none'}.`,
    '',
    '| Check | Status | Detail |',
    '| --- | --- | --- |',
    ...(['state', 'binding', 'alerts'] as const).map(
      (name) => `| ${CHECK_LABEL[name]} | ${verdict.oracle[name].status} | ${escapeCell(verdict.oracle[name].summary)} |`,
    ),
    '',
    '## Run',
    '',
    `- Outcome: ${record.outcome}${record.reason ? ` (${record.reason.code}: ${record.reason.message})` : ''}; terminal action ${record.terminalAttempted ? 'attempted once' : 'never attempted'}`,
    `- Actions: ${record.actions} of ${b.maxActions}; last step \`${record.lastStepKey ?? 'none'}\``,
    `- Rung histogram: ${histogram(verdict)}`,
    `- Heals: ${verdict.heals.length} · Re-plans: ${verdict.replans.length}`,
    `- LLM calls: ${llmLine(verdict)}`,
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

/** The final console block. */
export function printFinalBlock(verdict: Verdict, context: ReportContext): void {
  const color = verdict.color === 'GREEN' ? green : verdict.color === 'AMBER' ? yellow : verdict.color === 'RED' ? red : dim;
  console.log('');
  console.log(color(bold(`━━ ${banner(verdict)} ━━`)));
  for (const reason of verdict.reasons) console.log(color(`  ${reason.code}: ${reason.message}`));
  console.log(`  ${healerLine(verdict)} · verifier: ${verdict.color}`);
  if (verdict.oracle.finalHeading) console.log(dim(`  final page: "${verdict.oracle.finalHeading}"`));
  console.log(dim(`  ${histogram(verdict)} · heals ${verdict.heals.length} · re-plans ${verdict.replans.length}`));
  console.log(dim(`  plan: ${context.planSource} · LLM calls ${llmLine(verdict)}`));
  console.log(dim(`  browser ${seconds(verdict.timings.browserMs)} · LLM ${seconds(verdict.timings.llmMs)} · total ${seconds(verdict.timings.totalMs)}`));
  console.log(dim(`  report: ${context.runDir}`));
}

import { sameTarget, StepSchema, type HealerIntent, type Milestone, type ReplanEvent, type Step } from '@hackwave/contracts';
import type { Page } from 'playwright';
import { z } from 'zod';
import { looksLikeCommit } from './commit';
import type { LlmAdapter, PromptFile } from './llm';
import { milestoneLine } from './planner';
import { describeStep, stepIssues } from './step-rules';
import { redactValues, screenTree, valueOwnersOf } from './tree';

/** Everything rung 5 is told about one milestone that the ladder could not carry on. Never an input value. */
export interface ReplanRequest {
  milestone: Milestone;
  /** Index of the step that failed; the steps before it are done and stay. */
  index: number;
  /** Why it failed: each rung's reason, or what the progress check saw. */
  failures: string[];
  /** Every step done in this run, in order. */
  done: Step[];
  attempt: number;
  maxAttempts: number;
  /** Earlier re-plans of this milestone in this run (their steps did not work either). */
  previous: ReplanEvent[];
  /** Milestones not done yet, other than this one: their steps are never written here. */
  later: Milestone[];
  /** The click that commits the goal, when known and this milestone is not the terminal one. */
  commit: Step | null;
  /** Step keys taken by done steps and by other milestones. */
  taken: ReadonlySet<string>;
}

/** The milestone's new remaining steps. No steps means the re-planner found no way forward, and reason says why. */
export interface Replan {
  steps: Step[];
  more: boolean;
  reason: string;
}

/** Rung 5: the strong model rewrites one milestone's remaining steps from the current screen. */
export interface Replanner {
  replan(page: Page, request: ReplanRequest): Promise<Replan>;
}

export interface ReplannerOptions {
  llm: LlmAdapter;
  prompt: PromptFile;
  /** Goal and input keys only. */
  healer: HealerIntent;
  /** Used only to check replies (a name equal to an input value must be a nameRef), never put into a prompt. */
  inputValues: Readonly<Record<string, string>>;
  tree: { maxNodes: number; maxTextChars: number };
}

const list = (lines: string[]) => (lines.length > 0 ? lines : ['(none)']);

export function createReplanner(options: ReplannerOptions): Replanner {
  const { llm, prompt, healer } = options;
  const valueOwners = valueOwnersOf(options.inputValues);

  return {
    async replan(page, request) {
      const { milestone, index } = request;
      const failed = milestone.steps[index];
      const { path, tree } = await screenTree(page, options.tree, valueOwners);
      const rules = { screen: tree.text, inputKeys: healer.inputKeys, valueOwners };
      const schema = z
        .strictObject({ steps: z.array(StepSchema), more: z.boolean().default(false), reason: z.string().min(1) })
        .superRefine((value, ctx) => {
          const issue = (at: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: at, message });
          for (const found of stepIssues(value.steps, rules, new Set(request.taken))) issue(['steps', ...found.path], found.message);
          const last = value.steps[value.steps.length - 1];
          const leaves = last?.action === 'click' || last?.action === 'press';
          if (value.more && !last) issue(['more'], 'with no steps there is no next screen: "more" must be false');
          else if (value.more && !leaves) issue(['more'], '"more": true is only for steps that end with the click that leaves this screen');
          if (milestone.terminal && last && !value.more && !leaves) issue(['steps'], 'the terminal milestone must end with the click that commits the goal');
          // Terminal protection: the committing click never runs from another milestone, re-planned or not.
          const commit = request.commit;
          if (!milestone.terminal) {
            value.steps.forEach((step, at) => {
              const committing = (commit && sameTarget(step, commit)) || ((step.action === 'click' || step.action === 'press') && looksLikeCommit(step.target?.name));
              if (committing) issue(['steps', at], 'this is the click that commits the goal; it belongs only to the terminal milestone');
            });
          }
        });

      const doneHere = milestone.steps.slice(0, index);
      const input = [
        `GOAL: ${healer.goal}`,
        `INPUT KEYS: ${healer.inputKeys.join(', ')}`,
        `CURRENT PATH: ${path}`,
        `MILESTONE TO RE-PLAN: ${milestone.key}${milestone.terminal ? ' (terminal)' : ''}: ${milestone.description} (attempt ${request.attempt} of ${request.maxAttempts})`,
        'ITS STEPS ALREADY DONE:',
        ...list(doneHere.map((step) => `- ${step.key}: ${describeStep(step)}`)),
        `STEP THAT FAILED: ${failed ? `${failed.key}: ${describeStep(failed)}` : '(none)'}`,
        'WHY IT FAILED:',
        // Failure reasons quote the page (scope names, alerts): input values in them become {key}.
        ...list(request.failures.map((failure) => `- ${redactValues(failure, valueOwners)}`)),
        'PLANNED STEPS YOUR STEPS REPLACE:',
        ...list(milestone.steps.slice(index).map((step) => `- ${step.key}: ${describeStep(step)}`)),
        ...(request.previous.length > 0
          ? [
              'EARLIER RE-PLANS OF THIS MILESTONE (they did not work either):',
              ...request.previous.map((event) => `- attempt ${event.attempt}: ${event.newSteps.map(describeStep).join('; ')}`),
            ]
          : []),
        'LATER MILESTONES (not yours; never write their steps):',
        ...list(request.later.map(milestoneLine)),
        'STEPS ALREADY DONE IN THIS RUN:',
        ...list(request.done.map((step) => `- ${step.key}: ${describeStep(step)}`)),
        'SCREEN (pruned accessibility tree):',
        tree.text,
      ].join('\n');
      return llm.call({ stage: 'replanner', prompt, input, schema });
    },
  };
}

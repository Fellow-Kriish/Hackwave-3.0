import {
  CompletionSchema,
  parsePlan,
  PlanSchema,
  sameTarget,
  sha256,
  StepSchema,
  type HealerIntent,
  type Milestone,
  type Plan,
  type Step,
} from '@hackwave/contracts';
import type { Page } from 'playwright';
import { z } from 'zod';
import { looksLikeCommit } from './commit';
import type { LlmAdapter, PromptFile } from './llm';
import { describeStep, stepIssues } from './step-rules';
import { screenTree, valueOwnersOf, type TreeLimits } from './tree';

/** Steps written for one milestone on one screen; more means it continues on a later screen. */
export interface Expansion {
  steps: Step[];
  more: boolean;
}

/** What the executor needs from a planner. The executor itself never talks to a model. */
export interface PlanSource {
  /** The milestone plan, from the goal and the landing screen. Milestones come back with no steps. */
  plan(page: Page): Promise<Plan>;
  /**
   * Steps for pending[0] and for each following milestone that can be done on this same screen.
   * pending[0] may already have steps (it was marked more); the new steps continue it.
   * commit is the terminal milestone's committing step when it is already known.
   * later lists the milestones after pending that already have steps: the model must not write their steps.
   */
  expand(page: Page, pending: Milestone[], done: Step[], commit: Step | null, later?: Milestone[]): Promise<Map<string, Expansion>>;
}

export interface PlannerOptions {
  llm: LlmAdapter;
  prompts: { plan: PromptFile; expand: PromptFile };
  /** Goal and input keys only: the planner never sees the oracle or an input value. */
  healer: HealerIntent;
  /**
   * Input values, used only to check replies (a name equal to an input value must be a nameRef).
   * They are never put into a prompt.
   */
  inputValues: Readonly<Record<string, string>>;
  goalHash: string;
  tree: TreeLimits;
}

/** Cache identity of a planned plan: both planner prompts. */
export function planPromptHash(prompts: { plan: PromptFile; expand: PromptFile }): string {
  return sha256(`${prompts.plan.hash}\n${prompts.expand.hash}`);
}

/** "- key (terminal): description", as prompts list milestones that are not the model's to write. */
export function milestoneLine(milestone: Milestone): string {
  return `- ${milestone.key}${milestone.terminal ? ' (terminal)' : ''}: ${milestone.description}`;
}

export function createPlanner(options: PlannerOptions): PlanSource {
  const { llm, prompts, healer } = options;
  const inputKeys = healer.inputKeys;
  const promptHash = planPromptHash(prompts);
  const valueOwners = valueOwnersOf(options.inputValues);
  const screenOf = (page: Page) => screenTree(page, options.tree, valueOwners);

  return {
    async plan(page) {
      const { path, tree } = await screenOf(page);
      const base = { intentId: healer.id, goalHash: options.goalHash, promptHash, createdAt: new Date().toISOString() };
      const schema = z
        .strictObject({
          milestones: z
            .array(
              z.strictObject({
                key: z.string(),
                description: z.string().min(1),
                dependsOn: z.array(z.string()).default([]),
                completion: CompletionSchema,
                terminal: z.boolean().default(false),
              }),
            )
            .min(1)
            .max(10),
        })
        .superRefine((draft, ctx) => {
          const checked = PlanSchema.safeParse({ ...base, milestones: draft.milestones.map((milestone) => ({ ...milestone, steps: [] })) });
          if (!checked.success) for (const issue of checked.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
          if (draft.milestones.filter((milestone) => milestone.terminal).length !== 1) {
            ctx.addIssue({ code: 'custom', path: ['milestones'], message: 'exactly one milestone must be terminal: the last one, which commits the goal' });
          }
        });
      const input = [`GOAL: ${healer.goal}`, `INPUT KEYS: ${inputKeys.join(', ')}`, `START PATH: ${path}`, 'SCREEN (pruned accessibility tree):', tree.text].join('\n');
      const draft = await llm.call({ stage: 'planner', prompt: prompts.plan, input, schema });
      return parsePlan({ ...base, milestones: draft.milestones.map((milestone) => ({ ...milestone, steps: [] })) }, 'planner output');
    },

    async expand(page, pending, done, commit, later = []) {
      const { path, tree } = await screenOf(page);
      const rules = { screen: tree.text, inputKeys, valueOwners };
      const taken = new Set(done.map((step) => step.key));
      const schema = z
        .strictObject({
          milestones: z.array(z.strictObject({ milestone: z.string(), steps: z.array(StepSchema), more: z.boolean().default(false) })).min(1),
        })
        .superRefine((value, ctx) => {
          const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
          const seen = new Set(taken);
          // The click that commits the goal belongs to the terminal milestone only (the terminal rule).
          const terminalIndex = value.milestones.findIndex((milestone, index) => pending[index]?.terminal);
          const terminalReply = terminalIndex === -1 ? undefined : value.milestones[terminalIndex];
          const commitStep = terminalReply?.steps[terminalReply.steps.length - 1] ?? commit;
          if (commitStep) {
            value.milestones.forEach((milestone, index) => {
              if (index === terminalIndex) return;
              milestone.steps.forEach((step, stepIndex) => {
                if (sameTarget(step, commitStep)) {
                  issue(['milestones', index, 'steps', stepIndex], 'this is the click that commits the goal; it belongs only to the terminal milestone');
                }
              });
            });
          }
          value.milestones.forEach((milestone, index) => {
            const expected = pending[index];
            if (!expected) {
              issue(['milestones', index], `only ${pending.length} milestone(s) remain; remove "${milestone.milestone}"`);
              return;
            }
            if (milestone.milestone !== expected.key) {
              issue(['milestones', index, 'milestone'], `must be "${expected.key}" (a milestone key from the list, not a step key): expand milestones in the order given`);
            }
            for (const found of stepIssues(milestone.steps, rules, seen)) issue(['milestones', index, 'steps', ...found.path], found.message);
            if (!expected.terminal) {
              milestone.steps.forEach((step, stepIndex) => {
                if ((step.action === 'click' || step.action === 'press') && looksLikeCommit(step.target?.name)) {
                  issue(['milestones', index, 'steps', stepIndex], `"${step.target?.name}" looks like the click that commits the goal; it belongs only to the terminal milestone`);
                }
              });
            }
            // Empty steps close a milestone with nothing left to do: a started one, or one whose work a later
            // milestone in this same reply covers. Never the terminal one, and never to skip a screen not seen yet.
            if (milestone.steps.length === 0) {
              const closesStarted = index === 0 && expected.steps.length > 0;
              const coveredLater = value.milestones.slice(index + 1).some((later) => later.steps.length > 0);
              if (expected.terminal) issue(['milestones', index, 'steps'], 'the terminal milestone needs the click that commits the goal');
              else if (milestone.more) issue(['milestones', index, 'more'], 'a milestone closed with no steps cannot have "more": true');
              else if (!closesStarted && !coveredLater) {
                issue(['milestones', index, 'steps'], 'steps must not be empty here; close a milestone with "steps": [] only when a later milestone in this reply has steps');
              }
            }
            const lastStep = milestone.steps[milestone.steps.length - 1];
            if (milestone.more && lastStep && lastStep.action !== 'click' && lastStep.action !== 'press') {
              issue(['milestones', index, 'more'], '"more": true is only for a milestone whose last step leaves this screen (a click); finish everything this screen allows in this reply');
            }
            if (milestone.more && index !== value.milestones.length - 1) {
              issue(['milestones', index, 'more'], 'only the last milestone you return may have "more": true');
            }
            const last = milestone.steps[milestone.steps.length - 1];
            if (expected.terminal && !milestone.more && last && last.action !== 'click' && last.action !== 'press') {
              issue(['milestones', index, 'steps'], 'the terminal milestone must end with the click that commits the goal');
            }
          });
        });
      const input = [
        `GOAL: ${healer.goal}`,
        `INPUT KEYS: ${inputKeys.join(', ')}`,
        `CURRENT PATH: ${path}`,
        'MILESTONES STILL TO EXPAND, IN ORDER:',
        ...pending.map(
          (milestone, index) =>
            `${index + 1}. ${milestone.key}${milestone.terminal ? ' (terminal)' : ''}${milestone.steps.length > 0 ? ' (started)' : ''}: ${milestone.description}`,
        ),
        // Only when there are any, so plans expanded front to back keep their exact prompt (and recorded replies).
        ...(later.length > 0 ? ['LATER MILESTONES (already planned; never write their steps here):', ...later.map(milestoneLine)] : []),
        'STEPS ALREADY DONE:',
        ...(done.length > 0 ? done.map((step) => `- ${step.key}: ${describeStep(step)}`) : ['(none)']),
        `REPLY WITH THESE MILESTONE KEYS, IN THIS ORDER, STARTING WITH THE FIRST (a prefix of the list): ${pending.map((milestone) => milestone.key).join(', ')}`,
        'SCREEN (pruned accessibility tree):',
        tree.text,
      ].join('\n');
      const expansion = await llm.call({ stage: 'expand', prompt: prompts.expand, input, schema });
      return new Map(expansion.milestones.map((milestone) => [milestone.milestone, { steps: milestone.steps, more: milestone.more }]));
    },
  };
}

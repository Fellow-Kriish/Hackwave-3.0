import {
  CompletionSchema,
  parsePlan,
  PlanSchema,
  sha256,
  StepSchema,
  type HealerIntent,
  type Milestone,
  type Plan,
  type Step,
} from '@hackwave/contracts';
import type { Page } from 'playwright';
import { z } from 'zod';
import type { LlmAdapter, PromptFile } from './llm';
import { namePattern } from './resolve';
import { pruneAriaSnapshot, type PrunedTree } from './tree';

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
   */
  expand(page: Page, pending: Milestone[], done: Step[]): Promise<Map<string, Expansion>>;
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
  tree: { maxNodes: number; maxTextChars: number };
}

/** Cache identity of a planned plan: both planner prompts. */
export function planPromptHash(prompts: { plan: PromptFile; expand: PromptFile }): string {
  return sha256(`${prompts.plan.hash}\n${prompts.expand.hash}`);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is there a node with this role and (exact or {n}-templated) name in the pruned tree? */
function onScreen(screen: string, role: string, name: string): boolean {
  const pattern = new RegExp(`^\\s*- ${escapeRegExp(role)} "${namePattern(name).source.slice(1, -1)}"`, 'm');
  return pattern.test(screen);
}

function describeStep(step: Step): string {
  if (step.action === 'navigate') return `navigate ${step.path}`;
  const target = step.target;
  if (!target) return `${step.action} ${step.action === 'press' ? step.pressKey : ''}`.trim();
  const name = target.name ?? `{${target.nameRef ?? ''}}`;
  const within = target.within ? ` in ${target.within.role} "${target.within.name ?? `{${target.within.nameRef ?? ''}}`}"` : '';
  const input = step.action === 'fill' || step.action === 'select' ? ` <- ${step.inputRef}` : '';
  return `${step.action} ${target.role} "${name}"${within}${input}`;
}

async function screenOf(page: Page, limits: PlannerOptions['tree']): Promise<{ path: string; tree: PrunedTree }> {
  const snapshot = await page.locator('body').ariaSnapshot({ timeout: 3000 });
  return { path: new URL(page.url()).pathname, tree: pruneAriaSnapshot(snapshot, limits) };
}

export function createPlanner(options: PlannerOptions): PlanSource {
  const { llm, prompts, healer } = options;
  const inputKeys = healer.inputKeys;
  const promptHash = planPromptHash(prompts);
  const valueOwners = new Map(Object.entries(options.inputValues).map(([key, value]) => [value.trim().toLowerCase(), key]));

  return {
    async plan(page) {
      const { path, tree } = await screenOf(page, options.tree);
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

    async expand(page, pending, done) {
      const { path, tree } = await screenOf(page, options.tree);
      const known = new Set(inputKeys);
      const taken = new Set(done.map((step) => step.key));
      const schema = z
        .strictObject({
          milestones: z.array(z.strictObject({ key: z.string(), steps: z.array(StepSchema).min(1), more: z.boolean().default(false) })).min(1),
        })
        .superRefine((value, ctx) => {
          const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
          const seen = new Set(taken);
          value.milestones.forEach((milestone, index) => {
            const expected = pending[index];
            if (!expected) {
              issue(['milestones', index], `only ${pending.length} milestone(s) remain; remove "${milestone.key}"`);
              return;
            }
            if (milestone.key !== expected.key) issue(['milestones', index, 'key'], `must be "${expected.key}": expand milestones in the order given`);
            milestone.steps.forEach((step, stepIndex) => {
              const at = ['milestones', index, 'steps', stepIndex];
              if (seen.has(step.key)) issue([...at, 'key'], `step key "${step.key}" is already used`);
              seen.add(step.key);
              if ((step.action === 'fill' || step.action === 'select') && !known.has(step.inputRef)) {
                issue([...at, 'inputRef'], `"${step.inputRef}" is not an input key; use one of ${inputKeys.join(', ')}`);
              }
              if (!('target' in step) || !step.target) return;
              for (const ref of [step.target.nameRef, step.target.within?.nameRef]) {
                if (ref !== undefined && !known.has(ref)) issue([...at, 'target'], `"${ref}" is not an input key`);
              }
              // Plans reference inputs by key, never by value, so a cached plan works for any value of that input.
              for (const [where, name] of [
                ['target', step.target.name],
                ['target.within', step.target.within?.name],
              ] as const) {
                const owner = name === undefined ? undefined : valueOwners.get(name.trim().toLowerCase());
                if (owner) issue([...at, ...where.split('.')], `"${name}" is the value of input ${owner}; write "nameRef":"${owner}" instead of "name"`);
              }
              if (step.target.name !== undefined && !onScreen(tree.text, step.target.role, step.target.name)) {
                issue([...at, 'target'], `there is no ${step.target.role} "${step.target.name}" on this screen; copy role and name exactly from the tree, writing a changing count as {n}`);
              }
              const within = step.target.within;
              if (within?.name !== undefined && !onScreen(tree.text, within.role, within.name)) {
                issue([...at, 'target', 'within'], `there is no ${within.role} "${within.name}" on this screen`);
              }
            });
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
        'STEPS ALREADY DONE:',
        ...(done.length > 0 ? done.map((step) => `- ${step.key}: ${describeStep(step)}`) : ['(none)']),
        'SCREEN (pruned accessibility tree):',
        tree.text,
      ].join('\n');
      const expansion = await llm.call({ stage: 'expand', prompt: prompts.expand, input, schema });
      return new Map(expansion.milestones.map((milestone) => [milestone.key, { steps: milestone.steps, more: milestone.more }]));
    },
  };
}

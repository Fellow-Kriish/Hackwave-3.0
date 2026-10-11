import { z } from 'zod';
import { InputKeySchema } from './intent';

export const RoleSchema = z.string().regex(/^[a-z]+$/, 'an ARIA role such as button or textbox');
const MilestoneKeySchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'milestone keys are lower-case words joined by hyphens');
const StepKeySchema = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'step keys look like "shipping.phone"');

const exactlyOneName = (value: { name?: string | undefined; nameRef?: string | undefined }) =>
  (value.name === undefined) !== (value.nameRef === undefined);
const NAME_RULE = 'give exactly one of name (a UI label) or nameRef (an input key, e.g. product)';

/** An ancestor to search inside first, e.g. the article named after the product. */
export const ScopeSchema = z
  .strictObject({
    role: RoleSchema,
    name: z.string().min(1).optional(),
    nameRef: InputKeySchema.optional(),
  })
  .refine(exactlyOneName, NAME_RULE);
export type Scope = z.infer<typeof ScopeSchema>;

/**
 * What a step acts on, by role and accessible name. Names match exactly; "{n}" in a name stands for any
 * whole number, for labels whose count changes during the run ("Cart ({n})"). Names that are input values
 * (the product) are given as nameRef so a plan never carries a literal input value.
 */
export const TargetSchema = z
  .strictObject({
    role: RoleSchema,
    name: z.string().min(1).optional(),
    nameRef: InputKeySchema.optional(),
    synonyms: z.array(z.string().min(1)).default([]),
    within: ScopeSchema.optional(),
    hint: z.string().optional(),
  })
  .refine(exactlyOneName, NAME_RULE);
export type Target = z.infer<typeof TargetSchema>;

/** The expected effect of an action; when absent the executor checks by action type. */
export const ProgressSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('readback') }),
  z.strictObject({ kind: z.literal('change') }),
  z.strictObject({ kind: z.literal('visible'), role: RoleSchema, name: z.string().min(1) }),
  z.strictObject({ kind: z.literal('url'), pathPrefix: z.string().startsWith('/') }),
]);
export type Progress = z.infer<typeof ProgressSchema>;

const stepBase = { key: StepKeySchema, progress: ProgressSchema.optional() };

/** fill and select take an inputRef, never a literal value: strict objects reject a "value" field outright. */
export const StepSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...stepBase, action: z.literal('click'), target: TargetSchema }),
  z.strictObject({ ...stepBase, action: z.literal('fill'), target: TargetSchema, inputRef: InputKeySchema }),
  z.strictObject({ ...stepBase, action: z.literal('select'), target: TargetSchema, inputRef: InputKeySchema }),
  z.strictObject({ ...stepBase, action: z.literal('press'), target: TargetSchema.optional(), pressKey: z.enum(['Enter', 'Tab']) }),
  z.strictObject({ ...stepBase, action: z.literal('navigate'), path: z.string().startsWith('/') }),
]);
export type Step = z.infer<typeof StepSchema>;

/** The healer's soft "I think I'm done": read from the aria tree, never from the store. */
export const CompletionSchema = z.discriminatedUnion('kind', [
  /** A visible heading contains the text, or any of several texts (useful before the screen has been seen). */
  z.strictObject({ kind: z.literal('heading'), text: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(6)]) }),
  z.strictObject({ kind: z.literal('visible'), role: RoleSchema, name: z.string().min(1) }),
  z.strictObject({ kind: z.literal('url'), pathPrefix: z.string().startsWith('/') }),
  /** Every fill step of the milestone shows its input value. */
  z.strictObject({ kind: z.literal('filled') }),
]);
export type Completion = z.infer<typeof CompletionSchema>;

export const MilestoneSchema = z.strictObject({
  key: MilestoneKeySchema,
  description: z.string().min(1),
  dependsOn: z.array(MilestoneKeySchema).default([]),
  completion: CompletionSchema,
  /** True only for the action that commits the goal (place order). It runs at most once per run. */
  terminal: z.boolean().default(false),
  /** Empty until the planner expands the milestone on the live screen; cached once it has run. */
  steps: z.array(StepSchema),
  /** True once steps were written for it, even none (its work was covered by another milestone). */
  expanded: z.boolean().optional(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/** A milestone is expanded when it has steps, or was explicitly closed with none. */
export function isExpanded(milestone: Milestone): boolean {
  return milestone.steps.length > 0 || milestone.expanded === true;
}

/** Same role, name and scope: the same element as far as a plan can tell. */
export function sameTarget(a: Step, b: Step): boolean {
  if (!('target' in a) || !('target' in b) || !a.target || !b.target) return false;
  const scope = (step: typeof a.target) => (step.within ? `${step.within.role}|${step.within.name ?? ''}|${step.within.nameRef ?? ''}` : '');
  return (
    a.target.role === b.target.role &&
    (a.target.name ?? '') === (b.target.name ?? '') &&
    (a.target.nameRef ?? '') === (b.target.nameRef ?? '') &&
    scope(a.target) === scope(b.target)
  );
}

export const PlanSchema = z
  .strictObject({
    intentId: z.string().min(1),
    goalHash: z.string().min(1),
    promptHash: z.string().min(1),
    createdAt: z.iso.datetime(),
    milestones: z.array(MilestoneSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    const stepKeys = new Set<string>();
    plan.milestones.forEach((milestone, index) => {
      if (seen.has(milestone.key)) {
        ctx.addIssue({ code: 'custom', path: ['milestones', index, 'key'], message: `duplicate milestone "${milestone.key}"` });
      }
      // Listed by dependency: a milestone may only depend on milestones above it, which also rules out cycles.
      for (const dependency of milestone.dependsOn) {
        if (!seen.has(dependency)) {
          ctx.addIssue({
            code: 'custom',
            path: ['milestones', index, 'dependsOn'],
            message: `"${milestone.key}" depends on "${dependency}", which is not listed above it`,
          });
        }
      }
      seen.add(milestone.key);
      milestone.steps.forEach((step, stepIndex) => {
        if (stepKeys.has(step.key)) {
          ctx.addIssue({ code: 'custom', path: ['milestones', index, 'steps', stepIndex, 'key'], message: `duplicate step "${step.key}"` });
        }
        stepKeys.add(step.key);
      });
    });
    if (plan.milestones.filter((milestone) => milestone.terminal).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['milestones'], message: 'a plan has at most one terminal milestone' });
    }
    // Nothing runs after the terminal action: the run goes straight to the verifier.
    const terminalIndex = plan.milestones.findIndex((milestone) => milestone.terminal);
    if (terminalIndex !== -1 && terminalIndex !== plan.milestones.length - 1) {
      ctx.addIssue({ code: 'custom', path: ['milestones', terminalIndex, 'terminal'], message: 'the terminal milestone must be the last one' });
    }
  });
export type Plan = z.infer<typeof PlanSchema>;

/** Input keys a plan references that the intent does not provide. */
export function planInputProblems(plan: Plan, inputKeys: readonly string[]): string[] {
  const known = new Set(inputKeys);
  const problems: string[] = [];
  const check = (stepKey: string, field: string, key: string | undefined) => {
    if (key !== undefined && !known.has(key)) problems.push(`${stepKey}: ${field} "${key}" is not an input of this intent`);
  };
  for (const milestone of plan.milestones) {
    for (const step of milestone.steps) {
      if (step.action === 'fill' || step.action === 'select') check(step.key, 'inputRef', step.inputRef);
      if ('target' in step && step.target) {
        check(step.key, 'target.nameRef', step.target.nameRef);
        check(step.key, 'target.within.nameRef', step.target.within?.nameRef);
      }
    }
  }
  return problems;
}

import { z } from 'zod';
import { RoleSchema, StepSchema } from './plan';

/** A semantic locator: role plus accessible name, optionally inside a scope. Never CSS, never XPath. */
export const LocatorSpecSchema = z
  .strictObject({
    role: RoleSchema,
    name: z.string(),
    within: z.strictObject({ role: RoleSchema, name: z.string() }).optional(),
    nth: z.number().int().nonnegative().optional(),
  })
  .refine((locator) => locator.nth === undefined || locator.within !== undefined, 'nth is only allowed inside a scope');
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

/** Objective validation flags; the report prints these, never a model-reported confidence. */
export const ValidationSchema = z.strictObject({
  unique: z.boolean(),
  visible: z.boolean(),
  enabled: z.boolean(),
  roleMatch: z.boolean(),
  inLandmark: z.boolean(),
});
export type Validation = z.infer<typeof ValidationSchema>;

export function validationPassed(validation: Validation): boolean {
  return Object.values(validation).every(Boolean);
}

export const RungSchema = z.number().int().min(1).max(5);

export const ResolvedSchema = z.strictObject({
  locator: LocatorSpecSchema,
  rung: RungSchema,
  validation: ValidationSchema,
  evidence: z.strictObject({
    ariaLine: z.string().nullable(),
    score: z.number().nullable(),
  }),
  ms: z.number().nonnegative(),
});
export type Resolved = z.infer<typeof ResolvedSchema>;

export const HealEventSchema = z.strictObject({
  runId: z.string(),
  milestoneKey: z.string(),
  stepKey: z.string(),
  from: LocatorSpecSchema.nullable(),
  to: LocatorSpecSchema,
  rung: RungSchema,
  reason: z.string(),
  validation: ValidationSchema,
  ms: z.number().nonnegative(),
  /** When the locator stayed the same and the element moved: where to, e.g. 'from main to region "New arrivals"'. */
  moved: z.string().optional(),
});
export type HealEvent = z.infer<typeof HealEventSchema>;

export const ReplanEventSchema = z.strictObject({
  milestoneKey: z.string(),
  /** Why the milestone went to rung 5: each rung's failure, or what the progress check saw. */
  reason: z.string(),
  oldSteps: z.array(StepSchema),
  newSteps: z.array(StepSchema),
  attempt: z.number().int().positive(),
  /** The re-planner's own one sentence on what changed and what the new steps do. */
  rationale: z.string().optional(),
});
export type ReplanEvent = z.infer<typeof ReplanEventSchema>;

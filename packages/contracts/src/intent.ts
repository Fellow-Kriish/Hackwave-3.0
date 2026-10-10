import { z } from 'zod';

const inputName = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'input names are lowerCamelCase');

/** An input key: "product", or one level of grouping such as "card.number". */
export const InputKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)?$/, 'not an input key');

export const BudgetsSchema = z.strictObject({
  stepMs: z.number().int().positive(),
  runMs: z.number().int().positive(),
  maxActions: z.number().int().positive(),
  maxReplansPerMilestone: z.number().int().nonnegative(),
  maxLlmCallsPerRun: z.number().int().nonnegative(),
  maxRung3AttemptsPerStepPerScreen: z.number().int().nonnegative(),
});
export type Budgets = z.infer<typeof BudgetsSchema>;

/** Named inputs: a value, or one group of values (card.number, shipping.phone). */
export const InputsSchema = z.record(inputName, z.union([z.string(), z.record(inputName, z.string())]));
export type Inputs = z.infer<typeof InputsSchema>;

/** The frozen success condition. Read only by packages/verifier; stripped by redactForHealer everywhere else. */
export const OracleSchema = z.strictObject({
  state: z.strictObject({
    /** The system-of-record collection, read through /api/<store>. */
    store: z.string().regex(/^[a-z][a-z0-9-]*$/),
    expectedNewCount: z.number().int().positive(),
    /** Fields the new record must carry. */
    match: z
      .strictObject({
        items: z.array(z.string().min(1)).min(1).optional(),
        total: z.number().nonnegative().optional(),
        cardLast4: z.string().regex(/^\d{4}$/).optional(),
      })
      .refine((match) => Object.values(match).some((value) => value !== undefined), 'match needs at least one field'),
    /** How long to wait for the record to appear; engine.config.json verifier.pollMs when absent. */
    pollMs: z.number().int().positive().optional(),
  }),
  ui: z.strictObject({
    /** The backend's new id, normalised, appears in the final page text. */
    newRecordIdVisible: z.boolean(),
    /** No role=alert with text on the final page. */
    noAlerts: z.boolean(),
  }),
});
export type Oracle = z.infer<typeof OracleSchema>;

export const IntentSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lower-case words joined by hyphens'),
  goal: z.string().min(10),
  inputs: InputsSchema,
  oracle: OracleSchema,
  /** Optional overrides of engine.config.json budgets. */
  budgets: BudgetsSchema.partial().optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

/** { card: { number } } becomes { "card.number": ... }: the keys plan steps reference. */
export function flattenInputs(inputs: Inputs): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(inputs)) {
    if (typeof value === 'string') {
      flat[name] = value;
    } else {
      for (const [field, fieldValue] of Object.entries(value)) flat[`${name}.${field}`] = fieldValue;
    }
  }
  return flat;
}

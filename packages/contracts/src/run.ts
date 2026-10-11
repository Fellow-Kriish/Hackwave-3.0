import { z } from 'zod';
import { HealEventSchema, ReplanEventSchema } from './records';

export const ReasonSchema = z.strictObject({
  /** Machine code, e.g. state_delta_failed. */
  code: z.string().min(1),
  /** One human line. */
  message: z.string().min(1),
});
export type Reason = z.infer<typeof ReasonSchema>;

/**
 * How execution ended. completed: ran through the terminal action (or every milestone).
 * unresolvable: stopped before it, refusing to guess. refused: an action fell outside the allowlist.
 * environment: timeout, crash, navigation or network error.
 */
export const RunOutcomeSchema = z.enum(['completed', 'unresolvable', 'refused', 'environment']);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

export const TimingsSchema = z.strictObject({
  browserMs: z.number().nonnegative(),
  llmMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
  steps: z.array(z.strictObject({ key: z.string(), kind: z.enum(['browser', 'llm']), ms: z.number().nonnegative() })),
});
export type Timings = z.infer<typeof TimingsSchema>;

const count = z.number().int().nonnegative();

export const RungHistogramSchema = z.strictObject({ '1': count, '2': count, '3': count, '4': count, '5': count });
export type RungHistogram = z.infer<typeof RungHistogramSchema>;

export function emptyRungHistogram(): RungHistogram {
  return { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
}

/** total counts every adapter call, live or replayed; cached is how many of them came from runs/llm-cache. */
export const LlmCallsSchema = z.strictObject({ total: count, cached: count, byModel: z.record(z.string(), count) });
export type LlmCalls = z.infer<typeof LlmCallsSchema>;

export const TokensSchema = z.strictObject({
  input: count,
  output: count,
  byModel: z.record(z.string(), z.strictObject({ input: count, output: count })),
});
export type Tokens = z.infer<typeof TokensSchema>;

/** The healer's own "I think I'm done", read from milestone completion conditions. Soft. */
export const HealerDoneSchema = z.strictObject({
  believed: z.boolean(),
  atStep: count.nullable(),
  stepKey: z.string().nullable(),
});
export type HealerDone = z.infer<typeof HealerDoneSchema>;

/** What the executor hands the verifier. It never contains the oracle. */
export const RunRecordSchema = z.strictObject({
  runId: z.string().min(1),
  intentId: z.string().min(1),
  target: z.url(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  outcome: RunOutcomeSchema,
  reason: ReasonSchema.nullable(),
  terminalAttempted: z.boolean(),
  healerBelievedDone: HealerDoneSchema,
  actions: count,
  lastStepKey: z.string().nullable(),
  heals: z.array(HealEventSchema),
  replans: z.array(ReplanEventSchema),
  rungHistogram: RungHistogramSchema,
  llmCalls: LlmCallsSchema,
  tokens: TokensSchema,
  timings: TimingsSchema,
  /** Network or browser failures seen during the run, e.g. a request refused because the server died. */
  environmentErrors: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

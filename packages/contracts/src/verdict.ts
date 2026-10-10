import { z } from 'zod';
import { HealEventSchema, ReplanEventSchema } from './records';
import {
  HealerDoneSchema,
  LlmCallsSchema,
  ReasonSchema,
  RungHistogramSchema,
  TimingsSchema,
  TokensSchema,
} from './run';

/**
 * pass / fail: the check ran and decided. error: it could not run (store unreachable, page gone).
 * skipped: not applicable this run (terminal action never attempted, or a check it depends on had nothing to give).
 * disabled: the oracle switched it off.
 */
export const CheckStatusSchema = z.enum(['pass', 'fail', 'error', 'skipped', 'disabled']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const ComparedSchema = z.strictObject({
  field: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  ok: z.boolean(),
});
export type Compared = z.infer<typeof ComparedSchema>;

export const CheckResultSchema = z.strictObject({
  status: CheckStatusSchema,
  summary: z.string(),
  compared: z.array(ComparedSchema),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

const RecordIdSchema = z.union([z.number(), z.string()]);

export const OracleResultSchema = z.strictObject({
  evaluated: z.boolean(),
  baseline: z.strictObject({ count: z.number().int().nonnegative(), maxId: RecordIdSchema.nullable() }),
  newRecordId: RecordIdSchema.nullable(),
  state: CheckResultSchema,
  binding: CheckResultSchema,
  alerts: CheckResultSchema,
  finalUrl: z.string().nullable(),
  /** The final page's h1, kept as evidence ("page claims ORD-4821"); never part of a check. */
  finalHeading: z.string().nullable(),
});
export type OracleResult = z.infer<typeof OracleResultSchema>;

export const VerdictColorSchema = z.enum(['GREEN', 'AMBER', 'RED', 'GREY']);
export type VerdictColor = z.infer<typeof VerdictColorSchema>;

/** The decision-table row that matched. incomplete is the safety net: GREY, never a pass. */
export const VerdictKindSchema = z.enum(['passed', 'ui_drift', 'real_bug', 'unresolvable', 'environment', 'incomplete']);
export type VerdictKind = z.infer<typeof VerdictKindSchema>;

export const VerdictSchema = z.strictObject({
  runId: z.string(),
  intentId: z.string(),
  target: z.string(),
  color: VerdictColorSchema,
  kind: VerdictKindSchema,
  reasons: z.array(ReasonSchema).min(1),
  oracle: OracleResultSchema,
  heals: z.array(HealEventSchema),
  replans: z.array(ReplanEventSchema),
  healerBelievedDone: HealerDoneSchema,
  llmCalls: LlmCallsSchema,
  tokens: TokensSchema,
  timings: TimingsSchema,
  rungHistogram: RungHistogramSchema,
});
export type Verdict = z.infer<typeof VerdictSchema>;

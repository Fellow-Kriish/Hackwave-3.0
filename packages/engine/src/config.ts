import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetsSchema } from '@hackwave/contracts';
import { z } from 'zod';
import { findRepoRoot } from './paths';

const positiveInt = z.number().int().positive();
const ratio = z.number().min(0).max(1);
const port = z.number().int().min(1).max(65535);
const tier = z.enum(['strong', 'fast']);

/** engine.config.json: every budget, threshold and knob lives here. Unknown keys are rejected to catch typos. */
export const EngineConfigSchema = z.strictObject({
  /** Shared with intents, which may override any budget. */
  budgets: BudgetsSchema,
  ladder: z.strictObject({
    similarityAccept: ratio,
    similarityMargin: ratio,
    candidatesPerStep: positiveInt,
    fullTreeBelowScore: ratio,
    visionEnabled: z.boolean(),
  }),
  tree: z.strictObject({
    maxNodes: positiveInt,
    maxTextChars: positiveInt,
  }),
  settle: z.strictObject({
    sampleGapMs: positiveInt,
    maxWaitMs: positiveInt,
  }),
  verifier: z.strictObject({
    pollMs: positiveInt,
  }),
  /** Which tier each stage uses; tier model ids come from env (LLM_MODEL_STRONG, LLM_MODEL_FAST), never from code. */
  models: z.strictObject({
    planner: tier,
    replanner: tier,
    resolver: tier,
    explain: tier,
  }),
  /** The API key is never in this file: env LLM_API_KEY only. */
  llm: z.strictObject({
    mode: z.enum(['live', 'record', 'replay']),
    provider: z.string().min(1),
    providerFast: z.string().min(1).nullable(),
    baseUrl: z.url().nullable(),
  }),
  shop: z.strictObject({
    ports: z.strictObject({
      v1: port,
      v2: port,
      'v2-broken': port,
    }),
  }),
});

export type EngineConfig = z.infer<typeof EngineConfigSchema>;

export function loadConfig(root: string = findRepoRoot()): EngineConfig {
  const file = join(root, 'engine.config.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsed = EngineConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

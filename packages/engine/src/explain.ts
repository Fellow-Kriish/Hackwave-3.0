import type { Verdict } from '@hackwave/contracts';
import { z } from 'zod';
import { LlmError, type LlmAdapter, type PromptFile } from './llm';
import { redactValues } from './tree';

/** The RED hypothesis, or why there is none. It is narration: written after the verdict, never part of it. */
export type Explanation = { hypothesis: string } | { skipped: string };

export interface Explainer {
  explain(verdict: Verdict): Promise<Explanation>;
}

export interface ExplainerOptions {
  llm: LlmAdapter;
  prompt: PromptFile;
  /** Used only to replace input values with {key}; values never reach the prompt. */
  valueOwners: ReadonlyMap<string, string>;
}

const CHECK_LABEL = { state: 'state delta', binding: 'UI-to-state binding', alerts: 'no error alerts' } as const;

function pathOf(url: string | null): string {
  if (!url) return '(unknown)';
  try {
    return new URL(url).pathname;
  } catch {
    return '(unknown)';
  }
}

/**
 * The evidence the explainer sees, from the verdict only. Nothing that changes between two runs with the same
 * outcome (run ids, ports, timings) is included, so a recorded hypothesis replays; input values become {key}.
 */
export function explainInput(verdict: Verdict, valueOwners: ReadonlyMap<string, string>): string {
  const redact = (text: string) => redactValues(text, valueOwners);
  const done = verdict.healerBelievedDone;
  const healer = done.believed
    ? `believed it was done after step ${done.stepKey}`
    : done.atStep === null
      ? 'stopped before finishing its plan'
      : `did not believe it was done after step ${done.stepKey}`;
  const { oracle } = verdict;
  return [
    `VERDICT: ${verdict.color} · ${verdict.kind}`,
    'REASONS:',
    ...verdict.reasons.map((reason) => `- ${reason.code}: ${redact(reason.message)}`),
    'ORACLE CHECKS:',
    ...(['state', 'binding', 'alerts'] as const).map((name) => `- ${CHECK_LABEL[name]}: ${oracle[name].status}: ${redact(oracle[name].summary)}`),
    `STORE: ${oracle.baseline.count} record(s) before the run; new record: ${oracle.newRecordId ?? 'none'}`,
    `HEALER (reads only the page): ${healer}`,
    `FINAL PAGE: ${oracle.finalHeading ? `heading "${redact(oracle.finalHeading)}"` : 'no heading'} at path ${pathOf(oracle.finalUrl)}`,
    `HEALING DURING THE RUN: ${verdict.heals.length} heal(s), ${verdict.replans.length} re-plan(s)`,
  ].join('\n');
}

/** Reporter-explain: one fast-model call after a RED real bug. Any model problem means no hypothesis, never a failed run. */
export function createExplainer(options: ExplainerOptions): Explainer {
  const schema = z.strictObject({ hypothesis: z.string().min(40).max(900) });
  return {
    async explain(verdict) {
      try {
        const reply = await options.llm.call({ stage: 'explain', prompt: options.prompt, input: explainInput(verdict, options.valueOwners), schema });
        return { hypothesis: reply.hypothesis.trim() };
      } catch (error) {
        if (!(error instanceof LlmError)) throw error;
        if (error.code === 'replay_cache_miss') return { skipped: 'not in the replay cache; record it with --llm-mode record' };
        return { skipped: error.message.split('\n')[0] ?? error.code };
      }
    },
  };
}

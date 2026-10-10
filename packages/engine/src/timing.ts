import { performance } from 'node:perf_hooks';

export type TimingKind = 'browser' | 'llm';

export interface StepTiming {
  key: string;
  kind: TimingKind;
  ms: number;
}

/** The shape Verdict.timings takes: browser time versus model time, plus the per-step list. */
export interface TimingSummary {
  browserMs: number;
  llmMs: number;
  totalMs: number;
  steps: StepTiming[];
}

/** Timing hook for a run: wrap each unit of browser or model work in measure(). */
export class Timings {
  private readonly startedAt = performance.now();
  private readonly steps: StepTiming[] = [];

  async measure<T>(kind: TimingKind, key: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      // Failed work still costs time; it is recorded either way.
      this.steps.push({ key, kind, ms: Math.round(performance.now() - started) });
    }
  }

  summary(): TimingSummary {
    const sum = (kind: TimingKind) =>
      this.steps.filter((step) => step.kind === kind).reduce((total, step) => total + step.ms, 0);
    return {
      browserMs: sum('browser'),
      llmMs: sum('llm'),
      totalMs: Math.round(performance.now() - this.startedAt),
      steps: this.steps.map((step) => ({ ...step })),
    };
  }
}

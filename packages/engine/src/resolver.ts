import type { HealerIntent } from '@hackwave/contracts';
import type { Page } from 'playwright';
import { z } from 'zod';
import type { Fingerprint } from './fingerprint';
import type { Expectation, ScoredCandidate } from './ladder';
import type { LlmAdapter, PromptFile } from './llm';
import { inputMark, screenTree, type TreeLimits } from './tree';

export interface Rung3Request {
  expectation: Expectation;
  /** What the step is for: its hint, or its milestone's description. */
  purpose: string;
  /** Best first, as rung 2 scored them. */
  candidates: ScoredCandidate[];
}

/** Rung 3: one fast-model call per screen picks a candidate (or none) for every step still unresolved there. */
export interface Rung3Picker {
  pick(page: Page, requests: Rung3Request[]): Promise<Map<string, ScoredCandidate | null>>;
}

export interface Rung3Options {
  llm: LlmAdapter;
  prompt: PromptFile;
  /** Goal and input keys only. */
  healer: HealerIntent;
  tree: TreeLimits;
  /** Used only to mark names on screen that are input values. */
  valueOwners: ReadonlyMap<string, string>;
  candidatesPerStep: number;
  fullTreeBelowScore: number;
}

function where(fingerprint: Fingerprint, valueOwners: ReadonlyMap<string, string>): string {
  const landmark = fingerprint.landmark ? ` · inside ${fingerprint.landmark.role}${fingerprint.landmark.name ? ` "${fingerprint.landmark.name}"` : ''}` : '';
  const near = fingerprint.siblingText.length
    ? ` · near ${fingerprint.siblingText.map((text) => `"${text}"${inputMark(text, valueOwners)}`).join(', ')}`
    : '';
  return `${landmark}${near}`;
}

export function createRung3Picker(options: Rung3Options): Rung3Picker {
  const { llm, prompt, healer, valueOwners } = options;

  const candidateLine = (candidate: ScoredCandidate) => {
    const scope = candidate.container ? ` in ${candidate.container.role} "${candidate.container.name}"${inputMark(candidate.container.name, valueOwners)}` : '';
    return `    ${candidate.id}: ${candidate.fingerprint.role} "${candidate.name}"${scope}${where(candidate.fingerprint, valueOwners)}`;
  };

  const before = (expectation: Expectation) => {
    const remembered = expectation.cached?.fingerprint;
    const scope = expectation.scope ? ` in ${expectation.scope.role} "${expectation.scope.name}"${inputMark(expectation.scope.name, valueOwners)}` : '';
    if (remembered) return `${remembered.role} "${remembered.name}"${scope}${where(remembered, valueOwners)}`;
    return `${expectation.role} "${expectation.target.name}"${scope}`;
  };

  return {
    async pick(page, requests) {
      const lists = requests.map((request) => request.candidates.slice(0, options.candidatesPerStep));
      // The whole pruned screen only when every candidate is weak; otherwise the short lists are enough.
      const weak = lists.every((list) => list.every((candidate) => candidate.score < options.fullTreeBelowScore));
      const screen = await screenTree(page, options.tree, valueOwners);
      const lines = [`GOAL: ${healer.goal}`, `SCREEN PATH: ${screen.path}`];
      requests.forEach((request, index) => {
        const { expectation } = request;
        const otherNames = expectation.names.filter((name) => name !== expectation.target.name);
        lines.push(`STEP ${index + 1}: ${expectation.stepKey}`);
        lines.push(`  purpose: ${request.purpose}`);
        lines.push(`  before: ${before(expectation)}`);
        if (otherNames.length > 0) lines.push(`  also known as: ${otherNames.map((name) => `"${name}"`).join(', ')}`);
        lines.push('  candidates:');
        const list = lists[index] ?? [];
        lines.push(...(list.length > 0 ? list.map(candidateLine) : ['    (none)']));
      });
      if (weak) lines.push('SCREEN (pruned accessibility tree):', screen.tree.text);

      const asked = requests.map((request) => request.expectation.stepKey);
      const schema = z
        .strictObject({ steps: z.array(z.strictObject({ step: z.string(), candidate: z.string().nullable() })) })
        .superRefine((value, ctx) => {
          const seen = new Set<string>();
          value.steps.forEach((answer, index) => {
            const at = asked.indexOf(answer.step);
            if (at === -1) ctx.addIssue({ code: 'custom', path: ['steps', index, 'step'], message: `"${answer.step}" was not asked; answer only ${asked.join(', ')}` });
            else if (seen.has(answer.step)) ctx.addIssue({ code: 'custom', path: ['steps', index, 'step'], message: `"${answer.step}" is answered twice` });
            seen.add(answer.step);
            const ids = (lists[at] ?? []).map((candidate) => candidate.id);
            if (at !== -1 && answer.candidate !== null && !ids.includes(answer.candidate)) {
              ctx.addIssue({ code: 'custom', path: ['steps', index, 'candidate'], message: `"${answer.candidate}" is not a candidate of ${answer.step}; use one of ${ids.join(', ') || '(none)'} or null` });
            }
          });
          for (const step of asked) if (!seen.has(step)) ctx.addIssue({ code: 'custom', path: ['steps'], message: `${step} is not answered` });
        });

      const reply = await llm.call({ stage: 'resolver', prompt, input: lines.join('\n'), schema });
      const picks = new Map<string, ScoredCandidate | null>();
      for (const answer of reply.steps) {
        const list = lists[asked.indexOf(answer.step)] ?? [];
        picks.set(answer.step, answer.candidate === null ? null : (list.find((candidate) => candidate.id === answer.candidate) ?? null));
      }
      return picks;
    },
  };
}

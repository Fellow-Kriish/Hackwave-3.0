import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parsePlan, type Plan } from '@hackwave/contracts';

/** runs/plans/<intentId>.json: a committed file, so the next run plans with 0 LLM calls. */
export function planCacheFile(root: string, intentId: string): string {
  return join(root, 'runs', 'plans', `${intentId}.json`);
}

export interface CachedPlanLookup {
  plan: Plan | null;
  /** Why the cache was not used, when it was not. */
  reason: string;
}

export function loadCachedPlan(root: string, intentId: string, goalHash: string, promptHash: string): CachedPlanLookup {
  const file = planCacheFile(root, intentId);
  if (!existsSync(file)) return { plan: null, reason: 'no cached plan' };
  let plan: Plan;
  try {
    plan = parsePlan(JSON.parse(readFileSync(file, 'utf8')), file);
  } catch (error) {
    return { plan: null, reason: `the cached plan is invalid: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` };
  }
  if (plan.intentId !== intentId) return { plan: null, reason: `the cached plan belongs to ${plan.intentId}` };
  if (plan.goalHash !== goalHash) return { plan: null, reason: 'the goal changed since the plan was cached' };
  if (plan.promptHash !== promptHash) return { plan: null, reason: 'the planner prompts changed since the plan was cached' };
  return { plan, reason: 'cached plan matches goal and prompts' };
}

export function savePlanCache(root: string, plan: Plan): string {
  const file = planCacheFile(root, plan.intentId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
  return file;
}

/**
 * Steps written this run (expanded or re-planned) are cached only once their milestone ran through. The rest go
 * back: a re-planned milestone to its steps as loaded (original), an expanded one to empty.
 */
export function cacheablePlan(
  plan: Plan,
  expandedThisRun: readonly string[],
  completed: readonly string[],
  replanned: { keys: readonly string[]; original: Plan | null } = { keys: [], original: null },
): Plan {
  const keep = new Set(completed);
  const expanded = new Set(expandedThisRun);
  const rewritten = new Set(replanned.keys);
  return {
    ...plan,
    milestones: plan.milestones.map((milestone) => {
      if (keep.has(milestone.key)) return milestone;
      if (rewritten.has(milestone.key)) {
        const before = replanned.original?.milestones.find((candidate) => candidate.key === milestone.key);
        if (before) return before;
      }
      if (!expanded.has(milestone.key) && !rewritten.has(milestone.key)) return milestone;
      const { expanded: _expanded, ...rest } = milestone;
      return { ...rest, steps: [] };
    }),
  };
}

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

/** Steps expanded this run are cached only once their milestone ran through; the rest go back to empty. */
export function cacheablePlan(plan: Plan, expandedThisRun: readonly string[], completed: readonly string[]): Plan {
  const keep = new Set(completed);
  const expanded = new Set(expandedThisRun);
  return {
    ...plan,
    milestones: plan.milestones.map((milestone) => {
      if (!expanded.has(milestone.key) || keep.has(milestone.key)) return milestone;
      const { expanded: _expanded, ...rest } = milestone;
      return { ...rest, steps: [] };
    }),
  };
}

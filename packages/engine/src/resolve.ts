import { performance } from 'node:perf_hooks';
import type { Resolved, Scope, Target, Validation } from '@hackwave/contracts';
import type { Locator, Page } from 'playwright';

type AriaRole = Parameters<Page['getByRole']>[0];

/** A target with every nameRef replaced by its input value. */
export interface ConcreteTarget {
  role: string;
  name: string;
  within?: { role: string; name: string };
}

function nameOf(holder: Target | Scope, inputs: Readonly<Record<string, string>>): string {
  if (holder.name !== undefined) return holder.name;
  const value = holder.nameRef === undefined ? undefined : inputs[holder.nameRef];
  if (value === undefined) throw new Error(`input "${holder.nameRef ?? ''}" is missing`);
  return value;
}

export function concreteTarget(target: Target, inputs: Readonly<Record<string, string>>): ConcreteTarget {
  const concrete: ConcreteTarget = { role: target.role, name: nameOf(target, inputs) };
  if (target.within) concrete.within = { role: target.within.role, name: nameOf(target.within, inputs) };
  return concrete;
}

export function describeTarget(target: ConcreteTarget): string {
  const scope = target.within ? ` in ${target.within.role} "${target.within.name}"` : '';
  return `${target.role} "${target.name}"${scope}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole-name pattern: the name exactly, with each "{n}" standing for any whole number ("Cart ({n})"). */
export function namePattern(name: string): RegExp {
  return new RegExp(`^${name.split('{n}').map(escapeRegExp).join('\\d+')}$`);
}

/** getByRole options: an exact name, or the whole-name pattern when the name carries {n}. */
export function nameOption(name: string): { name: string | RegExp; exact?: boolean } {
  return name.includes('{n}') ? { name: namePattern(name) } : { name, exact: true };
}

/** Semantic locators only: getByRole with an exact accessible name, scoped first when a scope is given. */
export function buildLocator(page: Page, target: ConcreteTarget): { scope: Locator | null; locator: Locator } {
  const scope = target.within ? page.getByRole(target.within.role as AriaRole, nameOption(target.within.name)) : null;
  const locator = (scope ?? page).getByRole(target.role as AriaRole, nameOption(target.name));
  return { scope, locator };
}

export type ResolveResult =
  | { ok: true; resolved: Resolved; locator: Locator }
  | { ok: false; resolved: Resolved; reason: string };

/**
 * Rung 1: build the locator from the target's role and name and validate it objectively:
 * exactly one match, role as expected, visible, enabled, inside its scope. No guessing past that.
 */
export async function resolveRung1(page: Page, target: ConcreteTarget, appearWithinMs: number): Promise<ResolveResult> {
  const started = performance.now();
  const { scope, locator } = buildLocator(page, target);
  // A target may render a moment after the page settles; wait briefly for it, never longer than the budget.
  await locator
    .first()
    .waitFor({ state: 'visible', timeout: Math.max(0, appearWithinMs) })
    .catch(() => undefined);

  const scopeCount = scope ? await scope.count() : 1;
  const count = scopeCount === 1 ? await locator.count() : 0;
  const unique = count === 1;
  const validation: Validation = {
    unique,
    visible: unique && (await locator.isVisible()),
    enabled: unique && (await locator.isEnabled()),
    // getByRole only matches the expected role, so a unique match is a role match.
    roleMatch: unique,
    inLandmark: scopeCount === 1 && unique,
  };
  const ariaLine = unique ? ((await locator.ariaSnapshot({ timeout: 1000 })).split('\n')[0] ?? null) : null;
  const resolved: Resolved = {
    locator: { role: target.role, name: target.name, ...(target.within ? { within: target.within } : {}) },
    rung: 1,
    validation,
    evidence: { ariaLine, score: unique ? 1 : null },
    ms: Math.round(performance.now() - started),
  };

  let reason: string | null = null;
  if (scopeCount !== 1) reason = scopeCount === 0 ? `scope ${target.within?.role} "${target.within?.name}" not found` : `scope matches ${scopeCount} elements`;
  else if (count === 0) reason = 'not found';
  else if (!unique) reason = `matches ${count} elements`;
  else if (!validation.visible) reason = 'not visible';
  else if (!validation.enabled) reason = 'disabled';

  return reason === null ? { ok: true, resolved, locator } : { ok: false, resolved, reason };
}

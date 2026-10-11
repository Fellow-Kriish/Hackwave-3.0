import { performance } from 'node:perf_hooks';
import type { Step, Validation } from '@hackwave/contracts';
import type { Locator, Page } from 'playwright';
import type { EngineConfig } from './config';
import { looksLikeCommit } from './commit';
import { describeElement, type Container, type Fingerprint } from './fingerprint';
import type { CachedLocator, LocatorCacheEntry } from './locator-cache';
import { buildLocator, concreteTarget, nameOption, type ConcreteTarget } from './resolve';
import { nameSimilarity, setOverlap, templateVolatileNumbers } from './similarity';

type AriaRole = Parameters<Page['getByRole']>[0];

/** Most candidates of one role looked at on a screen; the rest are ignored rather than slowing the run. */
const MAX_CANDIDATES = 50;

/** What a step expects, from its plan target and its locator cache entry. */
export interface Expectation {
  stepKey: string;
  role: string;
  /** Names worth matching: the step's own, its synonyms, and the name the element had when cached. */
  names: string[];
  /** The step's scope with input names filled in. A scope named by an input (the product) is required. */
  scope: { role: string; name: string; required: boolean; template: { role: string; name?: string; nameRef?: string } } | null;
  /** The step's own target, filled in: rung 1 uses it when there is no cache entry. */
  target: ConcreteTarget;
  cached: LocatorCacheEntry | null;
  hint: string | null;
  /** False outside the terminal milestone: heals never land on a control that commits the goal ("Pay ₹1,299"). */
  commitAllowed: boolean;
}

export function expectationFor(
  step: Step,
  entry: LocatorCacheEntry | undefined,
  inputs: Readonly<Record<string, string>>,
  commitAllowed = true,
): Expectation | null {
  if (!('target' in step) || !step.target) return null;
  const target = concreteTarget(step.target, inputs);
  const names = [target.name, ...step.target.synonyms, ...(entry ? [entry.fingerprint.name] : [])].filter((name, index, all) => name && all.indexOf(name) === index);
  const within = step.target.within;
  return {
    stepKey: step.key,
    role: step.target.role,
    names,
    scope:
      within && target.within
        ? { role: within.role, name: target.within.name, required: within.nameRef !== undefined, template: { ...within } }
        : null,
    target,
    cached: entry ?? null,
    hint: step.target.hint ?? null,
    commitAllowed,
  };
}

/**
 * Rung 2's score for one candidate: 0.8 × the best name similarity (step name, synonyms, cached name), plus 0.1
 * when it sits in the landmark the element was cached in, plus 0.1 × the overlap of nearby headings and labels.
 * With no cache entry, the name alone. Calibrated against labelled pairs in similarity.calibration.test.ts.
 */
export function similarityScore(candidate: Fingerprint, expectation: Pick<Expectation, 'names' | 'cached'>): number {
  const name = Math.max(0, ...expectation.names.map((expected) => nameSimilarity(expected, candidate.name)));
  const remembered = expectation.cached?.fingerprint;
  if (!remembered) return Math.round(name * 1000) / 1000;
  const sameLandmark = remembered.landmark && candidate.landmark && remembered.landmark.role === candidate.landmark.role ? 1 : 0;
  const siblings = setOverlap(remembered.siblingText, candidate.siblingText);
  return Math.round((0.8 * name + 0.1 * sameLandmark + 0.1 * siblings) * 1000) / 1000;
}

export interface ScoredCandidate {
  id: string;
  /** Positional locator, used only to describe and adopt the element; never cached. */
  locator: Locator;
  name: string;
  fingerprint: Fingerprint;
  container: Container | null;
  inScope: boolean;
  score: number;
}

export interface RungOutcome {
  ok: boolean;
  rung: 1 | 2 | 3;
  /** Why it failed, or how it matched. */
  reason: string;
  locator: Locator | null;
  /** The semantic locator, names filled in: what the step acts on and what the heal event shows. */
  target: ConcreteTarget | null;
  /** The same locator in template form, for the cache. */
  cachedLocator: CachedLocator | null;
  fingerprint: Fingerprint | null;
  validation: Validation;
  score: number | null;
  ms: number;
}

export interface Rung2Outcome extends RungOutcome {
  /** Every candidate looked at, best first: rung 3 picks from these. */
  candidates: ScoredCandidate[];
}

const NO_VALIDATION: Validation = { unique: false, visible: false, enabled: false, roleMatch: false, inLandmark: false };

export function describeLandmark(fingerprint: Fingerprint | null | undefined): string {
  const landmark = fingerprint?.landmark;
  return landmark ? `${landmark.role}${landmark.name ? ` "${landmark.name}"` : ''}` : 'no landmark';
}

export function concreteFromCached(cached: CachedLocator, inputs: Readonly<Record<string, string>>): ConcreteTarget | null {
  const name = cached.name ?? (cached.nameRef ? inputs[cached.nameRef] : undefined);
  if (name === undefined) return null;
  const target: ConcreteTarget = { role: cached.role, name };
  if (cached.within) {
    const scopeName = cached.within.name ?? (cached.within.nameRef ? inputs[cached.within.nameRef] : undefined);
    if (scopeName === undefined) return null;
    target.within = { role: cached.within.role, name: scopeName };
  }
  return target;
}

/** Names that are input values go back into the cache as nameRef, so the entry works for any value of that input. */
function toCached(target: ConcreteTarget, expectation: Expectation, valueOwners: ReadonlyMap<string, string>): CachedLocator {
  const owner = (name: string) => valueOwners.get(name.trim().toLowerCase());
  const nameRef = owner(target.name);
  const cached: CachedLocator = nameRef ? { role: target.role, nameRef } : { role: target.role, name: target.name };
  if (target.within) {
    const scope = expectation.scope;
    if (scope && scope.role === target.within.role && scope.name === target.within.name) cached.within = { ...scope.template };
    else {
      const scopeRef = owner(target.within.name);
      cached.within = scopeRef ? { role: target.within.role, nameRef: scopeRef } : { role: target.within.role, name: target.within.name };
    }
  }
  return cached;
}

export interface LadderOptions {
  page: Page;
  inputs: Readonly<Record<string, string>>;
  valueOwners: ReadonlyMap<string, string>;
  ladder: EngineConfig['ladder'];
}

export function createLadder(options: LadderOptions) {
  const { page, inputs, valueOwners, ladder } = options;

  /**
   * The locator to cache for a target that matched: input names become nameRef, and a price or count in the name
   * becomes {n} when the templated name still matches exactly one element, so "Pay ₹1,299" survives a price change.
   */
  async function cacheable(target: ConcreteTarget, expectation: Expectation): Promise<CachedLocator> {
    const cached = toCached(target, expectation, valueOwners);
    if (cached.name === undefined) return cached;
    const templated = templateVolatileNumbers(cached.name);
    if (templated === cached.name) return cached;
    const { locator } = buildLocator(page, { ...target, name: templated });
    return (await locator.count()) === 1 ? { ...cached, name: templated } : cached;
  }

  /**
   * Rung 1: the cached locator, or the step's own target when there is none yet. Validated objectively,
   * including that the element is still in the landmark it was cached in.
   */
  async function rung1(expectation: Expectation, appearWithinMs: number): Promise<RungOutcome> {
    const started = performance.now();
    const cachedTarget = expectation.cached ? concreteFromCached(expectation.cached.locator, inputs) : null;
    const target = cachedTarget ?? expectation.target;
    const { scope, locator } = buildLocator(page, target);
    // Only when there is time to wait: Playwright reads a timeout of 0 as "wait forever".
    if (appearWithinMs > 0) {
      await locator
        .first()
        .waitFor({ state: 'visible', timeout: appearWithinMs })
        .catch(() => undefined);
    }
    const scopeCount = scope ? await scope.count() : 1;
    const count = scopeCount === 1 ? await locator.count() : 0;
    const unique = count === 1;
    let fingerprint: Fingerprint | null = null;
    let landmarkOk = true;
    if (unique) {
      fingerprint = (await describeElement(locator, target.role)).fingerprint;
      const expected = expectation.cached?.fingerprint.landmark;
      if (expected) landmarkOk = fingerprint.landmark?.role === expected.role;
    }
    const validation: Validation = {
      unique,
      visible: unique && (await locator.isVisible()),
      enabled: unique && (await locator.isEnabled()),
      roleMatch: unique,
      inLandmark: scopeCount === 1 && unique && landmarkOk,
    };
    const what = `${expectation.cached ? 'cached locator' : 'plan target'} ${target.role} "${target.name}"`;
    let reason: string;
    if (scopeCount !== 1) reason = `${what}: scope ${target.within?.role} "${target.within?.name}" ${scopeCount === 0 ? 'not found' : `matches ${scopeCount}`}`;
    else if (count === 0) reason = `${what} not found`;
    else if (!unique) reason = `${what} matches ${count} elements`;
    else if (!landmarkOk) reason = `${what} moved from ${describeLandmark(expectation.cached?.fingerprint)} to ${describeLandmark(fingerprint)}`;
    else if (!validation.visible) reason = `${what} is not visible`;
    else if (!validation.enabled) reason = `${what} is disabled`;
    else reason = `${what} matched`;
    const ok = Object.values(validation).every(Boolean);
    return {
      ok,
      rung: 1,
      reason,
      locator: ok ? locator : null,
      target: ok ? target : null,
      cachedLocator: ok ? (expectation.cached?.locator ?? (await cacheable(target, expectation))) : null,
      fingerprint,
      validation,
      score: ok ? 1 : null,
      ms: Math.round(performance.now() - started),
    };
  }

  /** Would this candidate be the element a target names? Same role and name, in the same named container. */
  function isSameElement(candidate: ScoredCandidate, target: ConcreteTarget, expectation: Expectation): boolean {
    if (candidate.fingerprint.role !== target.role || candidate.name !== target.name) return false;
    const within = target.within;
    if (!within) return true;
    const inside = (box: { role: string; name: string } | null | undefined) => box?.role === within.role && box.name === within.name;
    return inside(candidate.container) || (candidate.inScope && inside(expectation.scope));
  }

  /**
   * Visible, named elements of the expected role: inside the scope first, the whole page only if the scope is
   * optional. Elements in avoid (what earlier steps already acted on, on this screen) are never candidates:
   * healing onto one would repeat that step, e.g. add the product to the cart twice.
   */
  async function candidatesFor(expectation: Expectation, avoid: readonly ConcreteTarget[] = []): Promise<{ candidates: ScoredCandidate[]; scopeMissing: boolean }> {
    let root: Page | Locator = page;
    let inScope = false;
    let scopeMissing = false;
    if (expectation.scope) {
      const scope = page.getByRole(expectation.scope.role as AriaRole, nameOption(expectation.scope.name));
      if ((await scope.count()) === 1) {
        root = scope;
        inScope = true;
      } else {
        scopeMissing = true;
        if (expectation.scope.required) return { candidates: [], scopeMissing };
      }
    }
    const collect = async (from: Page | Locator, scoped: boolean) => {
      const found: ScoredCandidate[] = [];
      const all = (await from.getByRole(expectation.role as AriaRole).filter({ visible: true }).all()).slice(0, MAX_CANDIDATES);
      for (const locator of all) {
        const { fingerprint, container } = await describeElement(locator, expectation.role);
        if (!fingerprint.name) continue;
        found.push({ id: '', locator, name: fingerprint.name, fingerprint, container, inScope: scoped, score: similarityScore(fingerprint, expectation) });
      }
      return found;
    };
    const fresh = (found: ScoredCandidate[]) =>
      found.filter(
        (candidate) =>
          !avoid.some((target) => isSameElement(candidate, target, expectation)) && (expectation.commitAllowed || !looksLikeCommit(candidate.name)),
      );
    let candidates = fresh(await collect(root, inScope));
    if (candidates.length === 0 && inScope && !expectation.scope?.required) candidates = fresh(await collect(page, false));
    candidates.sort((a, b) => b.score - a.score);
    candidates.forEach((candidate, index) => (candidate.id = `c${index + 1}`));
    return { candidates, scopeMissing };
  }

  /** Turns a chosen element into a unique role-and-name locator (scoped when needed) and validates it. */
  async function adopt(candidate: ScoredCandidate, expectation: Expectation, rung: 2 | 3, started: number, reasonPrefix: string): Promise<RungOutcome> {
    const attempts: ConcreteTarget[] = [];
    if (candidate.inScope && expectation.scope) attempts.push({ role: expectation.role, name: candidate.name, within: { role: expectation.scope.role, name: expectation.scope.name } });
    attempts.push({ role: expectation.role, name: candidate.name });
    if (candidate.container) attempts.push({ role: expectation.role, name: candidate.name, within: candidate.container });
    for (const target of attempts) {
      const { locator } = buildLocator(page, target);
      if ((await locator.count()) !== 1) continue;
      const validation: Validation = {
        unique: true,
        visible: await locator.isVisible(),
        enabled: await locator.isEnabled(),
        roleMatch: target.role === expectation.role,
        inLandmark: !expectation.scope?.required || candidate.inScope,
      };
      const ok = Object.values(validation).every(Boolean);
      return {
        ok,
        rung,
        reason: ok ? `${reasonPrefix}: ${target.role} "${target.name}"` : `${reasonPrefix}: ${target.role} "${target.name}" failed validation`,
        locator: ok ? locator : null,
        target: ok ? target : null,
        cachedLocator: ok ? await cacheable(target, expectation) : null,
        fingerprint: candidate.fingerprint,
        validation,
        score: candidate.score,
        ms: Math.round(performance.now() - started),
      };
    }
    return {
      ok: false,
      rung,
      reason: `${reasonPrefix}: no unique role-and-name locator for ${expectation.role} "${candidate.name}"`,
      locator: null,
      target: null,
      cachedLocator: null,
      fingerprint: candidate.fingerprint,
      validation: { ...NO_VALIDATION, roleMatch: true },
      score: candidate.score,
      ms: Math.round(performance.now() - started),
    };
  }

  /**
   * Rung 2: score candidates by name similarity (step name, synonyms, cached name) plus fingerprint boosts
   * (same landmark, same nearby text). Accept the best only above the threshold and clearly ahead of the next.
   */
  async function rung2(expectation: Expectation, avoid: readonly ConcreteTarget[] = []): Promise<Rung2Outcome> {
    const started = performance.now();
    const { candidates, scopeMissing } = await candidatesFor(expectation, avoid);
    const fail = (reason: string): Rung2Outcome => ({
      ok: false,
      rung: 2,
      reason,
      locator: null,
      target: null,
      cachedLocator: null,
      fingerprint: null,
      validation: NO_VALIDATION,
      score: candidates[0]?.score ?? null,
      ms: Math.round(performance.now() - started),
      candidates,
    });
    if (scopeMissing && expectation.scope?.required) {
      return fail(`required scope ${expectation.scope.role} "${expectation.scope.name}" is not on this screen`);
    }
    const [top, runnerUp] = candidates;
    if (!top) return fail(`no visible ${expectation.role} on this screen`);
    const margin = Math.round((top.score - (runnerUp?.score ?? 0)) * 1000) / 1000;
    if (top.score < ladder.similarityAccept) return fail(`best ${expectation.role} "${top.name}" scored ${top.score}, below ${ladder.similarityAccept}`);
    if (margin < ladder.similarityMargin) {
      return fail(`best ${expectation.role} "${top.name}" scored ${top.score}, only ${margin} ahead of "${runnerUp?.name ?? ''}"`);
    }
    const adopted = await adopt(top, expectation, 2, started, `similarity ${top.score}`);
    return { ...adopted, candidates };
  }

  return { rung1, rung2, adopt, candidatesFor };
}

export type Ladder = ReturnType<typeof createLadder>;

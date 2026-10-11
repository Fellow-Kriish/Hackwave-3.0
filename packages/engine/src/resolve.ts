import type { Scope, Target } from '@hackwave/contracts';
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

/** A whole-name pattern: the name exactly, with each "{n}" standing for any number, separators included ("1,299"). */
export function namePattern(name: string): RegExp {
  return new RegExp(`^${name.split('{n}').map(escapeRegExp).join('\\d+(?:[.,]\\d+)*')}$`);
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

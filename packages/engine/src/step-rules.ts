import type { Step } from '@hackwave/contracts';
import { namePattern } from './resolve';

/** What a model-written step is checked against: the screen it was written on and the intent's input keys. */
export interface StepRules {
  /** The pruned accessibility tree of the current screen. */
  screen: string;
  inputKeys: readonly string[];
  /** Input values, lower-cased, to their keys: a name equal to an input value must be written as a nameRef. */
  valueOwners: ReadonlyMap<string, string>;
}

export interface StepIssue {
  /** Path inside the steps array, e.g. [2, 'target']. */
  path: (string | number)[];
  message: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Is there a node with this role and (exact or {n}-templated) name in the pruned tree? */
export function onScreen(screen: string, role: string, name: string): boolean {
  const pattern = new RegExp(`^\\s*- ${escapeRegExp(role)} "${namePattern(name).source.slice(1, -1)}"`, 'm');
  return pattern.test(screen);
}

/** One line per step, as prompts show steps: action, target (input names as {key}) and the input it fills. */
export function describeStep(step: Step): string {
  if (step.action === 'navigate') return `navigate ${step.path}`;
  const target = step.target;
  if (!target) return `${step.action} ${step.action === 'press' ? step.pressKey : ''}`.trim();
  const name = target.name ?? `{${target.nameRef ?? ''}}`;
  const within = target.within ? ` in ${target.within.role} "${target.within.name ?? `{${target.within.nameRef ?? ''}}`}"` : '';
  const input = step.action === 'fill' || step.action === 'select' ? ` <- ${step.inputRef}` : '';
  return `${step.action} ${target.role} "${name}"${within}${input}`;
}

/**
 * The rules every model-written step obeys, whoever wrote it (step expansion or re-plan): a key not used yet,
 * inputs by key and never by value, a target copied from the current screen, and no Enter in a text field.
 * seen collects the keys used so far and is updated.
 */
export function stepIssues(steps: readonly Step[], rules: StepRules, seen: Set<string>): StepIssue[] {
  const known = new Set(rules.inputKeys);
  const issues: StepIssue[] = [];
  steps.forEach((step, index) => {
    const issue = (path: (string | number)[], message: string) => issues.push({ path: [index, ...path], message });
    if (seen.has(step.key)) issue(['key'], `step key "${step.key}" is already used`);
    seen.add(step.key);
    if ((step.action === 'fill' || step.action === 'select') && !known.has(step.inputRef)) {
      issue(['inputRef'], `"${step.inputRef}" is not an input key; use one of ${rules.inputKeys.join(', ')}`);
    }
    if (step.action === 'press' && step.pressKey === 'Enter' && step.target?.role === 'textbox') {
      issue([], 'never press Enter in a text field: it submits the form; click the form\'s button instead');
    }
    if (!('target' in step) || !step.target) return;
    for (const ref of [step.target.nameRef, step.target.within?.nameRef]) {
      if (ref !== undefined && !known.has(ref)) issue(['target'], `"${ref}" is not an input key`);
    }
    // Plans reference inputs by key, never by value, so a cached plan works for any value of that input.
    for (const [where, name] of [
      ['target', step.target.name],
      ['target.within', step.target.within?.name],
    ] as const) {
      const owner = name === undefined ? undefined : rules.valueOwners.get(name.trim().toLowerCase());
      if (owner) issue(where.split('.'), `"${name}" is the value of input ${owner}; write "nameRef":"${owner}" instead of "name"`);
    }
    if (step.target.name !== undefined && !onScreen(rules.screen, step.target.role, step.target.name)) {
      issue(['target'], `there is no ${step.target.role} "${step.target.name}" on this screen; copy role and name exactly from the tree, writing a changing count as {n}`);
    }
    const within = step.target.within;
    if (within?.name !== undefined && !onScreen(rules.screen, within.role, within.name)) {
      issue(['target', 'within'], `there is no ${within.role} "${within.name}" on this screen`);
    }
  });
  return issues;
}

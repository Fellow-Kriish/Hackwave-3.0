import type { Progress, Step } from '@hackwave/contracts';
import type { Locator, Page } from 'playwright';
import type { PageState } from './aria';
import { buildLocator, type ConcreteTarget } from './resolve';

type AriaRole = Parameters<Page['getByRole']>[0];

function needLocator(step: Step, locator: Locator | null): Locator {
  if (!locator) throw new Error(`${step.key}: no resolved target to act on`);
  return locator;
}

function needValue(step: Step, value: string | null): string {
  if (value === null) throw new Error(`${step.key}: no input value`);
  return value;
}

/** Performs one allowlisted action, bounded by the step budget. */
export async function perform(page: Page, step: Step, locator: Locator | null, value: string | null, origin: string, timeoutMs: number): Promise<void> {
  switch (step.action) {
    case 'click':
      await needLocator(step, locator).click({ timeout: timeoutMs });
      return;
    case 'fill':
      await needLocator(step, locator).fill(needValue(step, value), { timeout: timeoutMs });
      return;
    case 'select':
      await needLocator(step, locator).selectOption({ label: needValue(step, value) }, { timeout: timeoutMs });
      return;
    case 'press':
      if (locator) await locator.press(step.pressKey, { timeout: timeoutMs });
      else await page.keyboard.press(step.pressKey);
      return;
    case 'navigate':
      await page.goto(new URL(step.path, origin).toString(), { timeout: timeoutMs });
      return;
  }
}

export interface ProgressInput {
  page: Page;
  step: Step;
  locator: Locator | null;
  value: string | null;
  before: PageState;
  after: PageState;
  /** The next step's target, for the "next target became visible" signal. */
  nextTarget: ConcreteTarget | null;
}

export interface ProgressCheck {
  ok: boolean;
  detail: string;
}

function defaultProgress(step: Step): Progress {
  return step.action === 'fill' || step.action === 'select' ? { kind: 'readback' } : { kind: 'change' };
}

/**
 * Did the action do something? fill/select read the value back; click/press/navigate expect a URL change,
 * an aria tree change, or the next target to appear. Details never include input values.
 */
export async function checkProgress(input: ProgressInput): Promise<ProgressCheck> {
  const { page, step, locator, value, before, after, nextTarget } = input;
  const progress = step.progress ?? defaultProgress(step);
  switch (progress.kind) {
    case 'readback': {
      if (!locator || value === null) return { ok: false, detail: 'nothing to read back' };
      const actual =
        step.action === 'select'
          ? await locator.evaluate((element) => (element as HTMLSelectElement).selectedOptions[0]?.label ?? '')
          : await locator.inputValue({ timeout: 2000 });
      return actual === value ? { ok: true, detail: 'value read back' } : { ok: false, detail: 'the field read back a different value' };
    }
    case 'change': {
      if (after.url !== before.url) return { ok: true, detail: `url changed to ${new URL(after.url).pathname}` };
      if (after.fullHash !== before.fullHash) return { ok: true, detail: 'page changed' };
      if (nextTarget && (await buildLocator(page, nextTarget).locator.filter({ visible: true }).count()) > 0) {
        return { ok: true, detail: 'next target is visible' };
      }
      return { ok: false, detail: 'url, page and next target all unchanged' };
    }
    case 'visible': {
      const visible =
        (await page.getByRole(progress.role as AriaRole, { name: progress.name, exact: true }).filter({ visible: true }).count()) > 0;
      return { ok: visible, detail: `${progress.role} "${progress.name}" ${visible ? 'is visible' : 'did not appear'}` };
    }
    case 'url': {
      const path = new URL(after.url).pathname;
      const ok = path.startsWith(progress.pathPrefix);
      return { ok, detail: `path ${path} ${ok ? 'starts' : 'does not start'} with ${progress.pathPrefix}` };
    }
  }
}

import type { Milestone, Step } from '@hackwave/contracts';
import type { Page } from 'playwright';
import { buildLocator, concreteTarget, nameOption } from './resolve';
import { sameValue } from './values';

type AriaRole = Parameters<Page['getByRole']>[0];

export interface CompletionCheck {
  holds: boolean;
  detail: string;
}

type FillStep = Extract<Step, { action: 'fill' }>;

/**
 * The fill steps of the last stretch of the milestone that has any: steps are split at each click, press or
 * navigation, since those can leave the screen. [phone, continue, card number, expiry] gives [card number, expiry].
 */
export function lastScreenFills(milestone: Milestone): FillStep[] {
  let current: FillStep[] = [];
  let last: FillStep[] = [];
  for (const step of milestone.steps) {
    if (step.action === 'fill') {
      current.push(step);
      last = current;
    } else if (step.action === 'click' || step.action === 'press' || step.action === 'navigate') current = [];
  }
  return last;
}

/** The healer's soft "I think I'm done" for a milestone, read from the aria tree. Never the oracle. */
export async function completionHolds(page: Page, milestone: Milestone, inputs: Readonly<Record<string, string>>): Promise<CompletionCheck> {
  const { completion } = milestone;
  switch (completion.kind) {
    case 'heading': {
      const texts = Array.isArray(completion.text) ? completion.text : [completion.text];
      for (const text of texts) {
        if ((await page.getByRole('heading', { name: text }).filter({ visible: true }).count()) > 0) {
          return { holds: true, detail: `heading containing "${text}" is visible` };
        }
      }
      return { holds: false, detail: `no heading containing ${texts.map((text) => `"${text}"`).join(' or ')} is visible` };
    }
    case 'visible': {
      const holds = (await page.getByRole(completion.role as AriaRole, nameOption(completion.name)).filter({ visible: true }).count()) > 0;
      return { holds, detail: `${completion.role} "${completion.name}" ${holds ? 'is visible' : 'is not visible'}` };
    }
    case 'url': {
      const path = new URL(page.url()).pathname;
      const holds = path.startsWith(completion.pathPrefix);
      return { holds, detail: `path ${path} ${holds ? 'starts' : 'does not start'} with ${completion.pathPrefix}` };
    }
    case 'filled': {
      // Only the fields of the milestone's last screen: a click that left a screen took its fields with it.
      const fills = lastScreenFills(milestone);
      if (fills.length === 0) return { holds: false, detail: 'the milestone fills no field' };
      for (const step of fills) {
        const { locator } = buildLocator(page, concreteTarget(step.target, inputs));
        if ((await locator.count()) !== 1) return { holds: false, detail: `${step.key}: field not found` };
        if (!sameValue(await locator.inputValue({ timeout: 2000 }), inputs[step.inputRef] ?? '')) return { holds: false, detail: `${step.key} does not hold its input` };
      }
      return { holds: true, detail: 'every field holds its input' };
    }
  }
}

import type { Step } from '@hackwave/contracts';

export type AllowResult = { ok: true } | { ok: false; code: string; message: string };

const ACTIONS = new Set(['navigate', 'click', 'fill', 'select', 'press']);
const KEYS = new Set(['Enter', 'Tab']);

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Action allowlist, checked at run time even though plans are schema-validated, because plans will come
 * from a model: navigate within the app origin, click, fill, select, press Enter or Tab. Nothing else.
 */
export function checkAllowed(step: Step, origin: string, inputKeys: ReadonlySet<string>): AllowResult {
  if (!ACTIONS.has(step.action)) {
    return { ok: false, code: 'action_refused', message: `${step.key}: action "${step.action}" is not allowed` };
  }
  if (step.action === 'press' && !KEYS.has(step.pressKey)) {
    return { ok: false, code: 'action_refused', message: `${step.key}: only Enter and Tab may be pressed` };
  }
  if (step.action === 'navigate' && !sameOrigin(new URL(step.path, origin).toString(), origin)) {
    return { ok: false, code: 'action_refused', message: `${step.key}: navigation outside ${origin} is not allowed` };
  }
  if ((step.action === 'fill' || step.action === 'select') && !inputKeys.has(step.inputRef)) {
    return { ok: false, code: 'action_refused', message: `${step.key}: "${step.inputRef}" is not an input of this intent` };
  }
  return { ok: true };
}

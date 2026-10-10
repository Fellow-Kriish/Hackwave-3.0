import { flattenInputs, type Intent } from './intent';

/** The only view of an intent that the planner, resolver and re-planner may see. */
export interface HealerIntent {
  readonly id: string;
  readonly goal: string;
  readonly inputKeys: readonly string[];
}

/**
 * Strips the oracle and every input value: healing changes the path, never the goal, and a model that
 * only sees input keys cannot "fix" a failing form by inventing a different card.
 * Built field by field, never by spreading the intent, so nothing new can leak through by accident.
 */
export function redactForHealer(intent: Intent): HealerIntent {
  return Object.freeze({
    id: intent.id,
    goal: intent.goal,
    inputKeys: Object.freeze(Object.keys(flattenInputs(intent.inputs)).sort()),
  });
}

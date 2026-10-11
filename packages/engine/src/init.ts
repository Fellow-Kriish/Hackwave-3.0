import { slugify } from './intent-lint';

/** Words that say nothing about what is tested, left out of a generated id. */
const FILLER = new Set(['a', 'an', 'the', 'as', 'i', 'my', 'and', 'with', 'to', 'of', 'for', 'in', 'on', 'at', 'reach', 'shopper', 'user', 'customer', 'want']);

/** "As a shopper, buy the Trail Runner shoes with a valid card" becomes "buy-trail-runner-shoes-valid". */
export function idFromGoal(goal: string): string {
  const words = goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !FILLER.has(word));
  return slugify(words.slice(0, 5).join('-')) || 'new-intent';
}

/**
 * A new intent file from a goal sentence: the goal as given, example inputs and an oracle skeleton, every value
 * still to fill in marked TODO, so `pnpm engine lint` fails until each one is replaced. No model is involved.
 */
export function scaffoldIntent(goal: string, id = idFromGoal(goal)): string {
  const intent = {
    id,
    goal: goal.trim(),
    inputs: {
      example: 'TODO: a value the test types or picks; plan steps refer to it as "example"',
      group: { field: 'TODO: related values go in a group; plan steps refer to this one as "group.field"' },
    },
    oracle: {
      state: {
        store: 'TODO: the collection the app writes to, read through /api/<store> (e.g. orders)',
        expectedNewCount: 1,
        match: { items: ['TODO: what the new record must contain; or use total / cardLast4'] },
      },
      ui: { newRecordIdVisible: true, noAlerts: true },
    },
  };
  return `${JSON.stringify(intent, null, 2)}\n`;
}

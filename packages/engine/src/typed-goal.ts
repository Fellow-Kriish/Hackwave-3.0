import { flattenInputs, type Inputs, type Intent, type Project } from '@hackwave/contracts';
import { readPath } from '@hackwave/verifier';
import { idFromGoal } from './init';

/** One product the app sells, as its catalogue API lists it. */
export interface CatalogItem {
  name: string;
  price: number;
}

/**
 * The app's catalogue: the matched project's catalog endpoint, else GET /api/products (the demo shop's); empty when
 * the app has none or it cannot be read.
 */
export async function fetchCatalog(origin: string, fetchImpl: typeof fetch = fetch, catalog?: Project['catalog']): Promise<CatalogItem[]> {
  // An app with no catalogue API has its products written in its project file.
  if (catalog?.items) return catalog.items.map((item) => ({ name: item.name, price: item.price }));
  try {
    const response = await fetchImpl(new URL(catalog?.list ?? '/api/products', origin).toString(), { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const list = catalog?.recordsPath ? readPath(body, catalog.recordsPath) : body;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item: unknown) => {
      const name = readPath(item, catalog?.name ?? 'name');
      const price = readPath(item, catalog?.price ?? 'price');
      return typeof name === 'string' && typeof price === 'number' ? [{ name, price }] : [];
    });
  } catch {
    return [];
  }
}

export interface TypedIntent {
  intent: Intent;
  /** What was decided and why, for the console. */
  notes: string[];
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT = '(\\d{1,2}|a|an|one|single|two|three|four|five|six|seven|eight|nine|ten)';
const toNumber = (word: string) => NUMBER_WORDS[word.toLowerCase()] ?? Number(word);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The catalogue products a goal names, longest names first so "Trail Runner Pro" is not read as "Trail Runner". */
export function productsNamed(goal: string, catalog: readonly CatalogItem[]): { item: CatalogItem; qty: number; stated: boolean }[] {
  let rest = goal;
  const found: { item: CatalogItem; qty: number; stated: boolean; at: number }[] = [];
  for (const item of [...catalog].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = new RegExp(`(?:\\b${COUNT}\\s+(?:x\\s+)?(?:pairs?\\s+of\\s+)?(?:the\\s+)?)?\\b${escape(item.name)}(?:e?s)?\\b`, 'i');
    const hit = pattern.exec(rest);
    if (!hit) continue;
    const word = hit[1];
    // "a" and "an" before a name are articles, not a stated quantity.
    const stated = word !== undefined && !['a', 'an'].includes(word.toLowerCase());
    found.push({ item, qty: word ? toNumber(word) : 1, stated, at: hit.index });
    rest = rest.slice(0, hit.index) + ' '.repeat(hit[0].length) + rest.slice(hit.index + hit[0].length);
  }
  return found.sort((a, b) => a.at - b.at).map(({ item, qty, stated }) => ({ item, qty, stated }));
}

/** A count of things the goal asks for without naming them: "order 2 items", "add one product to the cart". */
export function unitsAsked(goal: string): number | null {
  const hit = new RegExp(`\\b${COUNT}\\s+(?:more\\s+|different\\s+)?(?:items?|products?|things|pairs?|shoes)\\b`, 'i').exec(goal);
  return hit?.[1] ? toNumber(hit[1]) : null;
}

/**
 * An intent from a goal typed in plain words. The input values come from an existing intent's test data (a card,
 * an address). The success check is written here by code, never by a model, so the oracle stays frozen, and it only
 * checks what the goal actually says:
 *
 * - products named: exactly those items, the units asked for, their catalogue total, the card's last four digits;
 * - a count but no product ("order 2 items"): that many units, a total equal to the catalogue prices of whatever was
 *   bought, the card;
 * - neither: a total equal to the catalogue prices of whatever was bought, and the card. The test data's product is
 *   still offered to the planner, but the check does not assume it was the one bought.
 */
export function typedIntent(goal: string, baseInputs: Inputs, catalog: readonly CatalogItem[], store = 'orders'): TypedIntent {
  const text = goal.trim();
  const notes: string[] = [];
  const inputs: Inputs = structuredClone(baseInputs);
  const named = productsNamed(text, catalog);
  const units = named.length === 0 ? unitsAsked(text) : null;
  const priceList = Object.fromEntries(catalog.map((item) => [item.name, item.price]));
  const flat0 = flattenInputs(inputs);
  const digits = (flat0['card.number'] ?? '').replace(/\D/g, '');
  const cardLast4 = digits.length >= 4 ? { cardLast4: digits.slice(-4) } : {};
  let match: Intent['oracle']['state']['match'];

  if (named.length > 0) {
    inputs.product = named[0]?.item.name ?? '';
    const totalUnits = named.reduce((sum, entry) => sum + entry.qty, 0);
    const counted = named.length > 1 || named.some((entry) => entry.stated && entry.qty !== 1);
    match = {
      items: named.map((entry) => entry.item.name),
      total: named.reduce((sum, entry) => sum + entry.item.price * entry.qty, 0),
      ...(counted ? { itemCount: totalUnits } : {}),
      ...cardLast4,
    };
    notes.push(`products: ${named.map((entry) => (entry.qty > 1 ? `${entry.qty} x ${entry.item.name}` : entry.item.name)).join(', ')} (named in the goal)`);
  } else if (units !== null) {
    match = { itemCount: units, ...(catalog.length > 0 ? { prices: priceList } : {}), ...cardLast4 };
    notes.push(`products: not named; the goal asks for ${units} unit(s), so any products are accepted at their catalogue prices`);
  } else {
    match = { ...(catalog.length > 0 ? { prices: priceList } : {}), ...cardLast4 };
    notes.push(
      `products: not named in the goal; the check accepts whatever is bought at its catalogue price${typeof inputs.product === 'string' ? ` (the test data offers ${inputs.product} to the planner)` : ''}`,
    );
  }
  if (Object.keys(match).length === 0) throw new Error('there is nothing to check the outcome against: the goal names no product, the app has no catalogue, and the test data has no card');

  notes.push(
    `success check (code, not AI): exactly 1 new record in ${store} with ${[
      match.items ? `items ${match.items.join(', ')}` : '',
      match.itemCount !== undefined ? `${match.itemCount} unit(s)` : '',
      match.total !== undefined ? `total ${match.total}` : '',
      match.prices ? 'a total equal to the catalogue prices of what was bought' : '',
      match.cardLast4 ? `card ending ${match.cardLast4}` : '',
    ]
      .filter(Boolean)
      .join(', ')}, its id shown on the page, no error alert`,
  );
  notes.push(`test data: ${Object.keys(flattenInputs(inputs)).join(', ')} (values stay out of every prompt)`);

  const intent: Intent = {
    id: `typed-${idFromGoal(text)}`,
    goal: text,
    inputs,
    oracle: {
      state: { store, expectedNewCount: 1, match },
      ui: { newRecordIdVisible: true, noAlerts: true },
    },
  };
  return { intent, notes };
}

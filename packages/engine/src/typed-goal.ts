import { flattenInputs, type Inputs, type Intent } from '@hackwave/contracts';
import { idFromGoal } from './init';

/** One product the app sells, as its catalogue API lists it. */
export interface CatalogItem {
  name: string;
  price: number;
}

/** The app's catalogue from GET /api/products; empty when the app has none or it cannot be read. */
export async function fetchCatalog(origin: string, fetchImpl: typeof fetch = fetch): Promise<CatalogItem[]> {
  try {
    const response = await fetchImpl(`${origin}/api/products`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    return body.flatMap((item: unknown) => {
      const product = item as { name?: unknown; price?: unknown };
      return typeof product.name === 'string' && typeof product.price === 'number' ? [{ name: product.name, price: product.price }] : [];
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

/**
 * An intent from a goal typed in plain words. The input values come from an existing intent's test data (a card,
 * an address). The success check is written here by code, never by a model, so the oracle stays frozen: one new
 * order carrying the product (the one the goal names when it names a product the app sells, else the test data's),
 * that product's catalogue price, and the card's last four digits.
 */
export function typedIntent(goal: string, baseInputs: Inputs, catalog: readonly CatalogItem[]): TypedIntent {
  const text = goal.trim();
  const notes: string[] = [];
  const inputs: Inputs = structuredClone(baseInputs);
  const named = [...catalog].sort((a, b) => b.name.length - a.name.length).find((item) => text.toLowerCase().includes(item.name.toLowerCase()));
  if (named) {
    inputs.product = named.name;
    notes.push(`product: ${named.name} (named in the goal)`);
  } else if (typeof inputs.product === 'string') {
    notes.push(`product: ${inputs.product} (the goal names none the shop sells, so the test data's)`);
  }

  const flat = flattenInputs(inputs);
  const product = flat.product;
  const price = product === undefined ? undefined : catalog.find((item) => item.name.toLowerCase() === product.toLowerCase())?.price;
  const digits = (flat['card.number'] ?? '').replace(/\D/g, '');
  const match: Intent['oracle']['state']['match'] = {
    ...(product !== undefined ? { items: [product] } : {}),
    ...(price !== undefined ? { total: price } : {}),
    ...(digits.length >= 4 ? { cardLast4: digits.slice(-4) } : {}),
  };
  if (Object.keys(match).length === 0) throw new Error('there is nothing to check the outcome against: the test data has no product and no card');
  notes.push(
    `success check (code, not AI): exactly 1 new order in the store with ${[
      match.items ? `item ${match.items.join(', ')}` : '',
      match.total !== undefined ? `total ${match.total}` : '',
      match.cardLast4 ? `card ending ${match.cardLast4}` : '',
    ]
      .filter(Boolean)
      .join(', ')}, its id shown on the page, no error alert`,
  );
  notes.push(`test data: ${Object.keys(flat).join(', ')} (values stay out of every prompt)`);

  const intent: Intent = {
    id: `typed-${idFromGoal(text)}`,
    goal: text,
    inputs,
    oracle: {
      state: { store: 'orders', expectedNewCount: 1, match },
      ui: { newRecordIdVisible: true, noAlerts: true },
    },
  };
  return { intent, notes };
}

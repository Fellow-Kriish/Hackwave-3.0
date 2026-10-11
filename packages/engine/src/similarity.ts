/**
 * Numbers that change from run to run without changing what the element is: a price ("₹1,299", "$9.99"), a count
 * in brackets ("Cart (3)"), or the plan's own {n}. Other numbers (a size, a model number) are part of the name.
 */
export const VOLATILE_NUMBER = /(?:[₹$€£¥]\s?|\brs\.?\s?)\d+(?:[.,]\d+)*|\(\s*\d+\s*\)|\{n\}/giu;

/**
 * Lower-case, punctuation goes, and only volatile numbers become "#": "Cart (1)", "Cart (12)" and "Cart ({n})" all
 * read "cart #", "Pay ₹1,299" reads "pay #", but "Size 9" and "Size 10" stay different.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(VOLATILE_NUMBER, ' # ')
    .replace(/[^\p{L}\p{N}#\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Pay ₹1,299" becomes "Pay ₹{n}" and "Cart (3)" becomes "Cart ({n})"; other numbers stay. */
export function templateVolatileNumbers(name: string): string {
  return name.replace(VOLATILE_NUMBER, (match) => (match === '{n}' ? match : match.replace(/\d+(?:[.,]\d+)*/, '{n}')));
}

function dice<T>(a: T[], b: T[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<T, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);
  let shared = 0;
  for (const item of b) {
    const left = counts.get(item) ?? 0;
    if (left > 0) {
      shared++;
      counts.set(item, left - 1);
    }
  }
  return (2 * shared) / (a.length + b.length);
}

function trigrams(text: string): string[] {
  const padded = `  ${text} `;
  const grams: string[] = [];
  for (let i = 0; i < padded.length - 2; i++) grams.push(padded.slice(i, i + 3));
  return grams;
}

/** Same words, but only one side carries a price or count ("Pay" and "Pay ₹1,299", "Cart" and "Cart (3)"). */
const SAME_WORDS_PLUS_NUMBER = 0.95;

/**
 * 1 for the same normalised name; 0.95 when the words are the same and only one side adds a price or count;
 * else the better of token overlap and trigram overlap (Dice).
 */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const words = (text: string) => text.split(' ').filter((token) => token !== '#').join(' ');
  if (words(x) !== '' && words(x) === words(y)) return SAME_WORDS_PLUS_NUMBER;
  return Math.max(dice(x.split(' '), y.split(' ')), dice(trigrams(x), trigrams(y)));
}

/** Jaccard overlap of two sets of short texts, compared normalised. */
export function setOverlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a.map(normalizeName).filter(Boolean));
  const right = new Set(b.map(normalizeName).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}

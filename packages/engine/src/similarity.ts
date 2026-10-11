/** Lower-case, numbers become "#", punctuation goes: "Cart (1)", "Cart (12)" and "Cart ({n})" all read "cart #". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\{n\}/g, '0')
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/[^\p{L}#\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/** 1 for the same normalised name, else the better of token overlap and trigram overlap (Dice). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
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

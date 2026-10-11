import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RoleSchema, RungSchema } from '@hackwave/contracts';
import { z } from 'zod';

const exactlyOne = (value: { name?: string | undefined; nameRef?: string | undefined }) => (value.name === undefined) !== (value.nameRef === undefined);

/** A semantic locator in template form: names that are input values are stored as nameRef. */
export const CachedLocatorSchema = z
  .strictObject({
    role: RoleSchema,
    name: z.string().optional(),
    nameRef: z.string().optional(),
    within: z
      .strictObject({ role: RoleSchema, name: z.string().optional(), nameRef: z.string().optional() })
      .refine(exactlyOne, 'within needs exactly one of name and nameRef')
      .optional(),
  })
  .refine(exactlyOne, 'a cached locator needs exactly one of name and nameRef');
export type CachedLocator = z.infer<typeof CachedLocatorSchema>;

const FingerprintSchema = z.strictObject({
  role: RoleSchema,
  name: z.string(),
  landmark: z.strictObject({ role: z.string(), name: z.string().nullable() }).nullable(),
  siblingText: z.array(z.string()),
  href: z.string().nullable(),
  type: z.string().nullable(),
});

const EntrySchema = z.strictObject({
  locator: CachedLocatorSchema,
  fingerprint: FingerprintSchema,
  /** The rung that produced this entry: 1 for a first success, 2 or 3 for a heal. */
  rung: RungSchema,
  updatedByRun: z.string(),
  updatedAt: z.iso.datetime(),
});
export type LocatorCacheEntry = z.infer<typeof EntrySchema>;

const FileSchema = z.strictObject({
  intentId: z.string(),
  entries: z.record(z.string(), EntrySchema),
});

/**
 * runs/locators/<intentId>.json is the committed cache that planner plans use. Hand-written plans use a
 * separate, git-ignored <intentId>.hand.json, so trying a hand plan never rewrites the committed locators.
 */
export function locatorCacheFile(root: string, intentId: string, hand = false): string {
  return join(root, 'runs', 'locators', `${intentId}${hand ? '.hand' : ''}.json`);
}

/**
 * runs/locators/<intentId>.json, keyed by step key: a committed file. Heals update it in place; the engineer
 * reviews the diff, and the next run resolves those steps on rung 1 with no model call.
 */
export class LocatorCache {
  private readonly entries: Map<string, LocatorCacheEntry>;
  private readonly updated = new Set<string>();

  private constructor(
    readonly file: string,
    readonly intentId: string,
    entries: Record<string, LocatorCacheEntry>,
    /** Why an existing file was not used, if it was not. */
    readonly problem: string | null,
  ) {
    this.entries = new Map(Object.entries(entries));
  }

  static load(root: string, intentId: string, hand = false): LocatorCache {
    const file = locatorCacheFile(root, intentId, hand);
    if (!existsSync(file)) return new LocatorCache(file, intentId, {}, null);
    try {
      const parsed = FileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.intentId !== intentId) return new LocatorCache(file, intentId, {}, `the file belongs to ${parsed.intentId}`);
      return new LocatorCache(file, intentId, parsed.entries, null);
    } catch (error) {
      return new LocatorCache(file, intentId, {}, `the file is invalid: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }

  get(stepKey: string): LocatorCacheEntry | undefined {
    return this.entries.get(stepKey);
  }

  set(stepKey: string, entry: LocatorCacheEntry): void {
    this.entries.set(stepKey, entry);
    this.updated.add(stepKey);
  }

  /** Step keys written during this run. */
  updatedKeys(): string[] {
    return [...this.updated];
  }

  /** Writes the file if anything changed; entries are sorted so diffs stay small and readable. */
  save(): boolean {
    if (this.updated.size === 0) return false;
    const entries = Object.fromEntries([...this.entries].sort(([a], [b]) => a.localeCompare(b)));
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify({ intentId: this.intentId, entries }, null, 2)}\n`);
    return true;
  }
}

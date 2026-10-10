import type { CheckResult, Compared, Oracle } from '@hackwave/contracts';
import type { RecordId, StoreAdapter, StoreRecord } from './store';

export interface Baseline {
  takenAt: string;
  count: number;
  maxId: RecordId | null;
  ids: RecordId[];
}

export function baselineOf(records: StoreRecord[], takenAt = new Date().toISOString()): Baseline {
  const ids = records.map((record) => record.id);
  const numeric = ids.every((id) => typeof id === 'number');
  return {
    takenAt,
    count: records.length,
    maxId: ids.length === 0 ? null : numeric ? Math.max(...(ids as number[])) : (ids[ids.length - 1] ?? null),
    ids,
  };
}

/** Strip non-alphanumerics and lower-case, so "ORD-4821" and "#4821" both contain "4821". */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Node's fetch hides the real reason in error.cause, sometimes an AggregateError whose message is empty.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const why = cause ? cause.message || (cause as NodeJS.ErrnoException).code || cause.name : '';
  return why ? `${text} (${why})` : text;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function itemNames(record: StoreRecord): string[] | null {
  if (!Array.isArray(record.items)) return null;
  return record.items.map((item) => String((item as { name?: unknown } | null)?.name ?? ''));
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

function compareRecord(record: StoreRecord, match: Oracle['state']['match']): Compared[] {
  const compared: Compared[] = [];
  if (match.items !== undefined) {
    const actual = itemNames(record);
    compared.push({ field: 'items', expected: match.items, actual, ok: actual !== null && sameMembers(actual, match.items) });
  }
  if (match.total !== undefined) {
    compared.push({ field: 'total', expected: match.total, actual: record.total ?? null, ok: record.total === match.total });
  }
  if (match.cardLast4 !== undefined) {
    compared.push({ field: 'cardLast4', expected: match.cardLast4, actual: record.cardLast4 ?? null, ok: record.cardLast4 === match.cardLast4 });
  }
  return compared;
}

const show = (value: unknown) => (Array.isArray(value) ? `[${value.join(', ')}]` : String(value));

export interface StateDeltaInput {
  store: StoreAdapter;
  baseline: Baseline;
  expectedNewCount: number;
  match: Oracle['state']['match'];
  pollMs: number;
  intervalMs: number;
}

export interface StateDeltaOutput {
  result: CheckResult;
  /** The single new record, when there is exactly one. */
  record: StoreRecord | null;
  /** The last list response and the per-id response, for the evidence bundle. */
  listing: StoreRecord[] | null;
  fetched: StoreRecord | null;
}

/**
 * Check 1, state delta: poll the store until exactly the expected number of new records exists, then
 * match each against the oracle and read it back by id. The page is never consulted.
 */
export async function checkStateDelta(input: StateDeltaInput): Promise<StateDeltaOutput> {
  const { store, baseline, expectedNewCount, match, pollMs, intervalMs } = input;
  const known = new Set(baseline.ids.map(String));
  const deadline = Date.now() + pollMs;
  let listing: StoreRecord[] | null = null;
  let fresh: StoreRecord[] = [];
  let lastError: string | null;

  for (;;) {
    try {
      listing = await store.list();
      fresh = listing.filter((record) => !known.has(String(record.id)));
      lastError = null;
    } catch (error) {
      lastError = message(error);
    }
    if (lastError === null && fresh.length >= expectedNewCount) break;
    if (Date.now() >= deadline) break;
    await delay(intervalMs);
  }

  if (lastError !== null) {
    return {
      result: { status: 'error', summary: `the ${store.name} store could not be read: ${lastError}`, compared: [] },
      record: null,
      listing,
      fetched: null,
    };
  }

  const countCompared: Compared = { field: 'newRecords', expected: expectedNewCount, actual: fresh.length, ok: fresh.length === expectedNewCount };
  if (!countCompared.ok) {
    const waited = fresh.length < expectedNewCount ? ` after waiting ${pollMs} ms` : '';
    return {
      result: {
        status: 'fail',
        summary: `expected ${expectedNewCount} new record(s) in ${store.name}, found ${fresh.length}${waited} (baseline ${baseline.count})`,
        compared: [countCompared],
      },
      record: null,
      listing,
      fetched: null,
    };
  }

  const compared: Compared[] = [countCompared];
  for (const record of fresh) compared.push(...compareRecord(record, match).map((entry) => ({ ...entry, field: `${record.id}.${entry.field}` })));

  const record = fresh.length === 1 ? (fresh[0] ?? null) : null;
  let fetched: StoreRecord | null = null;
  if (record) {
    try {
      fetched = await store.get(record.id);
    } catch (error) {
      return {
        result: { status: 'error', summary: `the ${store.name} store could not be read: ${message(error)}`, compared },
        record,
        listing,
        fetched: null,
      };
    }
    compared.push({ field: `${record.id}.readBack`, expected: 'found by id', actual: fetched ? 'found by id' : 'not found (404)', ok: fetched !== null });
  }

  const mismatches = compared.filter((entry) => !entry.ok);
  if (mismatches.length > 0) {
    const detail = mismatches.map((entry) => `${entry.field} ${show(entry.actual)} ≠ expected ${show(entry.expected)}`).join('; ');
    return { result: { status: 'fail', summary: `new record in ${store.name} does not match: ${detail}`, compared }, record, listing, fetched };
  }
  const fields = compared
    .filter((entry) => entry.field.includes('.') && !entry.field.endsWith('readBack'))
    .map((entry) => `${entry.field.split('.').pop()} ${show(entry.actual)}`)
    .join(', ');
  return {
    result: { status: 'pass', summary: `1 new record ${String(record?.id)} in ${store.name}; ${fields} match`, compared },
    record,
    listing,
    fetched,
  };
}

/** Check 2, UI-to-state binding: the backend's new id, normalised, appears in the final page text. */
export function checkBinding(recordId: RecordId, pageText: string): CheckResult {
  const needle = normalise(String(recordId));
  const found = needle.length > 0 && normalise(pageText).includes(needle);
  return {
    status: found ? 'pass' : 'fail',
    summary: found ? `new record id ${recordId} is shown on the final page` : `new record id ${recordId} is not shown on the final page`,
    compared: [{ field: 'recordIdOnPage', expected: String(recordId), actual: found ? 'found' : 'not found', ok: found }],
  };
}

/** Check 3, no error state: no role=alert with text on the final page. */
export function checkAlerts(alertTexts: string[]): CheckResult {
  const errors = alertTexts.map((text) => text.replace(/\s+/g, ' ').trim()).filter((text) => text.length > 0);
  return {
    status: errors.length === 0 ? 'pass' : 'fail',
    summary: errors.length === 0 ? 'no error alerts on the final page' : `error alert on the final page: ${errors.join(' | ')}`,
    compared: [{ field: 'alerts', expected: [], actual: errors, ok: errors.length === 0 }],
  };
}

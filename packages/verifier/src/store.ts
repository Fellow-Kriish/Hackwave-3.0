import type { StoreConfig } from '@hackwave/contracts';
import type { Page } from 'playwright';

export type RecordId = string | number;

export interface StoreRecord {
  id: RecordId;
  [field: string]: unknown;
}

/** The system of record. HTTP today; a database adapter can replace it without touching the checks. */
export interface StoreAdapter {
  readonly name: string;
  readonly url: string;
  list(): Promise<StoreRecord[]>;
  /** null when the store answers 404 for this id. */
  get(id: RecordId): Promise<StoreRecord | null>;
}

function isStoreRecord(value: unknown): value is StoreRecord {
  if (typeof value !== 'object' || value === null) return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number';
}

/** Reads a dotted path such as "total" or "lines[].product.title"; "[]" maps over an array. */
export function readPath(value: unknown, path: string): unknown {
  const parts = path.split('.');
  const walk = (current: unknown, index: number): unknown => {
    if (index === parts.length) return current;
    const part = parts[index] ?? '';
    const many = part.endsWith('[]');
    const key = many ? part.slice(0, -2) : part;
    const next = current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
    if (!many) return walk(next, index + 1);
    return Array.isArray(next) ? next.map((entry) => walk(entry, index + 1)) : undefined;
  };
  return walk(value, 0);
}

/**
 * One record in the shape the checks read: id, items as [{ name, qty }], total, cardLast4. The app's own fields stay
 * alongside for the evidence bundle. Fields the project does not map are left as the app sent them.
 */
export function canonicalRecord(raw: unknown, fields: StoreConfig['fields']): StoreRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const id = readPath(raw, fields.id);
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const record: StoreRecord = { ...(raw as Record<string, unknown>), id };
  if (fields.items) {
    // One booked room or one subscribed plan is a single value: treat it as a one-item list.
    const read = readPath(raw, fields.items);
    const names = read === undefined || read === null ? read : Array.isArray(read) ? read : [read];
    const quantities = fields.quantity ? readPath(raw, fields.quantity) : undefined;
    record.items = Array.isArray(names)
      ? names.map((name, index) => {
          const qty = Array.isArray(quantities) ? quantities[index] : undefined;
          return { name: String(name ?? ''), qty: typeof qty === 'number' ? qty : 1 };
        })
      : undefined;
  }
  if (fields.total) record.total = readPath(raw, fields.total);
  if (fields.cardLast4) record.cardLast4 = readPath(raw, fields.cardLast4);
  return record;
}

/** Header values; "env:NAME" is read from the environment now, so no secret is ever written into a project file. */
function resolveHeaders(headers: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value.startsWith('env:')) {
      const variable = value.slice(4);
      const secret = process.env[variable];
      if (!secret) throw new Error(`header ${name} needs the environment variable ${variable}, which is not set`);
      resolved[name] = secret;
    } else resolved[name] = value;
  }
  return resolved;
}

/**
 * The store over HTTP. Without a config: GET /api/<store> and /api/<store>/<id> on the target origin, records as the
 * app sends them (the demo shop's contract). With a project's config: its base URL, paths, headers, list location and
 * field mapping, so any app's API can be the system of record.
 */
export function httpStore(origin: string, store: string, timeoutMs = 3000, config?: StoreConfig): StoreAdapter {
  const base = config?.baseUrl ?? origin;
  const listPath = config?.list ?? `/api/${store}`;
  const url = new URL(listPath, base).toString();
  const toRecord = (raw: unknown): StoreRecord | null => (config ? canonicalRecord(raw, config.fields) : isStoreRecord(raw) ? raw : null);

  async function getJson(target: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs), headers: config ? resolveHeaders(config.headers) : undefined });
    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, body };
  }

  return {
    name: store,
    url,
    async list() {
      const { status, body } = await getJson(url);
      if (status !== 200) throw new Error(`GET ${url} returned HTTP ${status}`);
      const list = config?.recordsPath ? readPath(body, config.recordsPath) : body;
      const records = Array.isArray(list) ? list.map(toRecord) : null;
      if (!records || records.some((record) => record === null)) throw new Error(`GET ${url} did not return a list of records with ids`);
      return records as StoreRecord[];
    },
    async get(id) {
      const path = config?.get ? config.get.replace('{id}', encodeURIComponent(String(id))) : `/api/${store}/${encodeURIComponent(String(id))}`;
      const target = new URL(path, base).toString();
      const { status, body } = await getJson(target);
      if (status === 404) return null;
      const record = status === 200 ? toRecord(body) : null;
      if (!record) throw new Error(`GET ${target} returned HTTP ${status}`);
      return record;
    },
  };
}

/**
 * The store of an app with no server: records saved in the browser's localStorage under the project's key, read from
 * the test's own page (a fresh browser per run, so nothing is left over from earlier runs). The page is the app's, but
 * the check reads what the app persisted, not what it printed: a confirmation shown over an unsaved order still fails.
 */
export function browserStorageStore(store: string, config: StoreConfig, page: () => Page | null): StoreAdapter {
  const key = config.key ?? '';
  async function read(): Promise<StoreRecord[]> {
    const current = page();
    if (!current || current.isClosed()) throw new Error(`no browser page to read localStorage["${key}"] from`);
    const raw = await current.evaluate((name) => window.localStorage.getItem(name), key);
    if (raw === null) return [];
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`localStorage["${key}"] is not JSON`);
    }
    const list = config.recordsPath ? readPath(body, config.recordsPath) : body;
    // The app has saved nothing in this collection yet: an empty store, not an error.
    if (list === undefined || list === null) return [];
    const records = Array.isArray(list) ? list.map((item) => canonicalRecord(item, config.fields)) : null;
    if (!records || records.some((record) => record === null)) throw new Error(`localStorage["${key}"]${config.recordsPath ? `.${config.recordsPath}` : ''} is not a list of records with ids`);
    return records as StoreRecord[];
  }
  return {
    name: store,
    url: `localStorage["${key}"]${config.recordsPath ? `.${config.recordsPath}` : ''}`,
    list: read,
    async get(id) {
      return (await read()).find((record) => String(record.id) === String(id)) ?? null;
    },
  };
}

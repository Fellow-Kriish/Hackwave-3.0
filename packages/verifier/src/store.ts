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

/** GET /api/<store> and GET /api/<store>/<id> on the target origin. */
export function httpStore(origin: string, store: string, timeoutMs = 3000): StoreAdapter {
  const url = new URL(`/api/${store}`, origin).toString();

  async function getJson(target: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, body };
  }

  return {
    name: store,
    url,
    async list() {
      const { status, body } = await getJson(url);
      if (status !== 200) throw new Error(`GET ${url} returned HTTP ${status}`);
      if (!Array.isArray(body) || !body.every(isStoreRecord)) throw new Error(`GET ${url} did not return a list of records with ids`);
      return body;
    },
    async get(id) {
      const target = `${url}/${encodeURIComponent(String(id))}`;
      const { status, body } = await getJson(target);
      if (status === 404) return null;
      if (status !== 200 || !isStoreRecord(body)) throw new Error(`GET ${target} returned HTTP ${status}`);
      return body;
    },
  };
}

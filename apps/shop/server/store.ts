import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FIRST_ORDER_ID, type Order } from '../shared/order';

interface StoreData {
  lastId: number;
  orders: Order[];
}

function emptyStore(): StoreData {
  return { lastId: FIRST_ORDER_ID - 1, orders: [] };
}

/** The orders store: the system of record. In memory, written through to one JSON file per variant. */
export class OrderStore {
  private data: StoreData;

  constructor(private readonly file: string) {
    this.data = existsSync(file) ? readStore(file) : emptyStore();
  }

  list(): Order[] {
    return structuredClone(this.data.orders);
  }

  get(id: number): Order | undefined {
    const order = this.data.orders.find((candidate) => candidate.id === id);
    return order && structuredClone(order);
  }

  /** The id the next saved order will get. Reading it does not consume it. */
  peekNextId(): number {
    return this.data.lastId + 1;
  }

  create(order: Omit<Order, 'id'>): Order {
    const saved: Order = { id: this.data.lastId + 1, ...structuredClone(order) };
    this.data = { lastId: saved.id, orders: [...this.data.orders, saved] };
    this.save();
    return structuredClone(saved);
  }

  reset(): void {
    this.data = emptyStore();
    this.save();
  }

  private save(): void {
    writeJsonAtomic(this.file, this.data);
  }
}

function readStore(file: string): StoreData {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const data = parsed as Partial<StoreData> | null;
  if (!data || !Number.isInteger(data.lastId) || !Array.isArray(data.orders)) {
    throw new Error(`Orders store ${file} is not valid. Delete the file to start empty.`);
  }
  return { lastId: data.lastId as number, orders: data.orders };
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Write to a temp file, then rename over the store; retries briefly when Windows or a sync client holds a lock. */
function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 5 || !RETRYABLE.has(code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
    }
  }
}

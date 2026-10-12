import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StoreConfigSchema } from '@hackwave/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baselineOf, checkStateDelta } from './checks';
import { canonicalRecord, httpStore, readPath, type StoreAdapter, type StoreRecord } from './store';

const prices = { 'Trail Runner': 1299, 'City Sneaker': 1899 };
const line = (name: string, qty = 1) => ({ name, qty });

function storeWith(fresh: StoreRecord): StoreAdapter {
  return {
    name: 'orders',
    url: 'http://test/api/orders',
    list: async () => [fresh],
    get: async () => fresh,
  };
}

const delta = (record: StoreRecord, match: Parameters<typeof checkStateDelta>[0]['match']) =>
  checkStateDelta({ store: storeWith(record), baseline: baselineOf([]), expectedNewCount: 1, match, pollMs: 50, intervalMs: 10 });

describe('checks that need no product names', () => {
  it('passes "order 2 items" when two units were bought at their catalogue prices', async () => {
    const { result } = await delta({ id: 4824, items: [line('Trail Runner'), line('City Sneaker')], total: 3198, cardLast4: '4242' }, { itemCount: 2, prices, cardLast4: '4242' });
    expect(result.status).toBe('pass');
  });

  it('counts quantities as units', async () => {
    const { result } = await delta({ id: 1, items: [line('Trail Runner', 2)], total: 2598 }, { itemCount: 2, prices });
    expect(result.status).toBe('pass');
  });

  it('fails a wrong total on any goal: the catalogue decides what it should be', async () => {
    const { result } = await delta({ id: 1, items: [line('Trail Runner')], total: 999 }, { prices });
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('totalFromCatalog 999 ≠ expected 1299');
  });

  it('fails an item the catalogue does not sell, and a wrong unit count', async () => {
    expect((await delta({ id: 1, items: [line('Moon Boot')], total: 10 }, { prices })).result.summary).toContain('not in the catalogue: Moon Boot');
    expect((await delta({ id: 1, items: [line('Trail Runner')], total: 1299 }, { itemCount: 2, prices })).result.summary).toContain('itemCount 1 ≠ expected 2');
  });
});

describe('a project maps any API onto the fields the checks read', () => {
  const fields = StoreConfigSchema.parse({ list: '/v1/orders', get: '/v1/orders/{id}', fields: { id: 'orderNo', items: 'lines[].product.title', quantity: 'lines[].count', total: 'amount.value', cardLast4: 'payment.last4' } }).fields;

  it('reads dotted and array paths', () => {
    expect(readPath({ a: { b: [{ c: 1 }, { c: 2 }] } }, 'a.b[].c')).toEqual([1, 2]);
    expect(readPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('turns a foreign record into id, items with quantities, total and card', () => {
    const raw = { orderNo: 'SO-77', lines: [{ product: { title: 'Trail Runner' }, count: 2 }], amount: { value: 2598 }, payment: { last4: '4242' } };
    expect(canonicalRecord(raw, fields)).toMatchObject({ id: 'SO-77', items: [{ name: 'Trail Runner', qty: 2 }], total: 2598, cardLast4: '4242' });
    expect(canonicalRecord({ lines: [] }, fields)).toBeNull();
  });

  describe('over HTTP', () => {
    let server: Server;
    let origin = '';
    const seen: string[] = [];
    beforeAll(async () => {
      server = createServer((request, response) => {
        seen.push(`${request.url} ${String(request.headers.authorization)}`);
        response.setHeader('content-type', 'application/json');
        if (request.url === '/v1/orders') response.end(JSON.stringify({ data: [{ orderNo: 7, lines: [], amount: { value: 0 } }] }));
        else if (request.url === '/v1/orders/7') response.end(JSON.stringify({ orderNo: 7, lines: [], amount: { value: 0 } }));
        else {
          response.statusCode = 404;
          response.end('{}');
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('uses the project paths, list location and headers, with secrets read from the environment', async () => {
      process.env.HW_TEST_TOKEN = 'Bearer s3cret';
      const config = StoreConfigSchema.parse({ list: '/v1/orders', get: '/v1/orders/{id}', recordsPath: 'data', headers: { authorization: 'env:HW_TEST_TOKEN' }, fields: { id: 'orderNo', total: 'amount.value' } });
      const store = httpStore(origin, 'orders', 3000, config);
      expect(await store.list()).toMatchObject([{ id: 7, total: 0 }]);
      expect(await store.get(7)).toMatchObject({ id: 7 });
      expect(await store.get(8)).toBeNull();
      expect(seen).toContain('/v1/orders Bearer s3cret');
      delete process.env.HW_TEST_TOKEN;
      await expect(store.list()).rejects.toThrow('header authorization needs the environment variable HW_TEST_TOKEN, which is not set');
    });
  });
});

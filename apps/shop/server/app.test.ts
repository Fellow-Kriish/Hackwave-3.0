import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Order, OrderRequest } from '../shared/order';
import type { ShopVersion } from '../shared/variants';
import { createApp, type AppOptions } from './app';

const validOrder: OrderRequest = {
  items: [{ productId: 'trail-runner', qty: 1 }],
  shipping: { name: 'Kartik Test', street: '12 MG Road', city: 'Indore', pincode: '452001', phone: '9876543210' },
  cardLast4: '4242',
  total: 1299,
};

let dir: string;
const servers: Server[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shop-test-'));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  rmSync(dir, { recursive: true, force: true });
});

async function start(version: ShopVersion, overrides: Partial<AppOptions> = {}): Promise<string> {
  const app = createApp({ version, storeFile: join(dir, `orders.${version}.json`), testMode: true, ...overrides });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, path: string, body?: unknown): Promise<Response> {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function orders(base: string): Promise<Order[]> {
  return (await (await fetch(`${base}/api/orders`)).json()) as Order[];
}

describe('v1', () => {
  it('saves orders with counter ids starting at 4821 and serves them back', async () => {
    const base = await start('v1');
    const created = await post(base, '/api/orders', validOrder);
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ id: 4821 });

    const order = (await (await fetch(`${base}/api/orders/4821`)).json()) as Order;
    expect(order).toMatchObject({ id: 4821, total: 1299, cardLast4: '4242' });
    expect(order.items).toEqual([{ productId: 'trail-runner', name: 'Trail Runner', qty: 1, unitPrice: 1299 }]);
    expect((await fetch(`${base}/api/orders/ORD-4821`)).status).toBe(200);

    expect(await (await post(base, '/api/orders', validOrder)).json()).toEqual({ id: 4822 });
    expect((await orders(base)).map((o) => o.id)).toEqual([4821, 4822]);
  });

  it('does not require a phone', async () => {
    const base = await start('v1');
    const { phone: _phone, ...shipping } = validOrder.shipping;
    expect((await post(base, '/api/orders', { ...validOrder, shipping })).status).toBe(200);
  });

  it('keeps orders across restarts', async () => {
    const storeFile = join(dir, 'shared.json');
    const first = await start('v1', { storeFile });
    await post(first, '/api/orders', validOrder);
    const second = await start('v1', { storeFile });
    expect((await orders(second)).map((o) => o.id)).toEqual([4821]);
  });
});

describe('reset', () => {
  it('clears the store and restarts the counter at 4821', async () => {
    const base = await start('v1');
    await post(base, '/api/orders', validOrder);
    await post(base, '/api/orders', validOrder);
    const reset = await post(base, '/api/_test/reset');
    expect(await reset.json()).toEqual({ ok: true, nextId: 4821 });
    expect(await orders(base)).toEqual([]);
    expect(await (await post(base, '/api/orders', validOrder)).json()).toEqual({ id: 4821 });
  });

  it('does not exist outside test mode', async () => {
    const base = await start('v1', { testMode: false });
    expect((await post(base, '/api/_test/reset')).status).toBe(404);
  });
});

describe('v2', () => {
  it('requires the new phone field', async () => {
    const base = await start('v2');
    const { phone: _phone, ...shipping } = validOrder.shipping;
    const response = await post(base, '/api/orders', { ...validOrder, shipping });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'shipping phone must be 10 digits' });
    expect((await post(base, '/api/orders', validOrder)).status).toBe(200);
  });
});

describe('v2-broken', () => {
  it('answers 200 with an id but persists nothing', async () => {
    const base = await start('v2-broken');
    const response = await post(base, '/api/orders', validOrder);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 4821 });
    expect((await fetch(`${base}/api/orders/4821`)).status).toBe(404);
    expect(await orders(base)).toEqual([]);
    // The id is never consumed, so every attempt claims the same order.
    expect(await (await post(base, '/api/orders', validOrder)).json()).toEqual({ id: 4821 });
  });
});

describe('v2-wrong-total', () => {
  it('saves the order with the wrong total', async () => {
    const base = await start('v2-wrong-total');
    expect((await post(base, '/api/orders', validOrder)).status).toBe(200);
    const [order] = await orders(base);
    expect(order?.total).toBe(999);
    expect(order?.items[0]?.unitPrice).toBe(999);
  });
});

describe('order validation', () => {
  it.each([
    ['an unknown product', { ...validOrder, items: [{ productId: 'nope', qty: 1 }] }],
    ['a zero quantity', { ...validOrder, items: [{ productId: 'trail-runner', qty: 0 }] }],
    ['a bad card last-4', { ...validOrder, cardLast4: '42' }],
    ['a bad pincode', { ...validOrder, shipping: { ...validOrder.shipping, pincode: '45' } }],
    ['a total that disagrees with the catalogue', { ...validOrder, total: 999 }],
  ])('rejects %s', async (_label, body) => {
    const base = await start('v1');
    expect((await post(base, '/api/orders', body)).status).toBe(400);
    expect(await orders(base)).toEqual([]);
  });

  it('rejects malformed JSON with a 400', async () => {
    const base = await start('v1');
    const response = await fetch(`${base}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });
});

describe('front end', () => {
  it('injects the version into the HTML for every client route', async () => {
    const distDir = join(dir, 'dist');
    mkdirSync(distDir);
    writeFileSync(join(distDir, 'index.html'), '<html><head><title>t</title></head><body></body></html>');
    const base = await start('v2-broken', { distDir });
    for (const path of ['/', '/checkout/shipping', '/orders/ORD-4821']) {
      const response = await fetch(base + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<script>window.__SHOP__={"version":"v2-broken"}</script></head>');
    }
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});

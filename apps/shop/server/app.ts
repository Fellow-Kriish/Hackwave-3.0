import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { PRODUCTS } from '../shared/catalogue';
import { VARIANTS, type ShopVersion } from '../shared/variants';
import { buildOrderRecord, catalogueTotal, parseOrderRequest } from './orders';
import { OrderStore } from './store';

export interface AppOptions {
  version: ShopVersion;
  storeFile: string;
  /** Enables POST /api/_test/reset. Set from SHOP_TEST_MODE=1. */
  testMode: boolean;
  /** Built front end (vite build output). Omit to serve the API only. */
  distDir?: string;
}

/** Parses "4821" and "ORD-4821" alike; anything else is not an order id. */
function parseOrderId(raw: string): number | undefined {
  const match = /^(?:ORD-)?(\d+)$/i.exec(raw);
  return match ? Number(match[1]) : undefined;
}

export function createApp(options: AppOptions): express.Express {
  const { version, testMode } = options;
  const flags = VARIANTS[version];
  const store = new OrderStore(options.storeFile);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  app.get('/api/_health', (_req, res) => {
    res.json({ ok: true, version, testMode });
  });

  app.get('/api/products', (_req, res) => {
    res.json(PRODUCTS);
  });

  app.get('/api/orders', (_req, res) => {
    res.json(store.list());
  });

  app.get('/api/orders/:id', (req, res) => {
    const id = parseOrderId(req.params.id);
    const order = id === undefined ? undefined : store.get(id);
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(order);
  });

  app.post('/api/orders', (req, res) => {
    const parsed = parseOrderRequest(req.body, flags);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const expected = catalogueTotal(parsed.value);
    if (parsed.value.total !== expected) {
      res.status(400).json({ error: `total ${parsed.value.total} does not match the catalogue total ${expected}` });
      return;
    }
    if (!flags.persistOrders) {
      // v2-broken: answer exactly like a successful save, with the id a save would have used, and persist nothing.
      res.status(200).json({ id: store.peekNextId() });
      return;
    }
    const order = store.create(buildOrderRecord(parsed.value, flags));
    res.status(200).json({ id: order.id });
  });

  app.post('/api/_test/reset', (_req, res) => {
    if (!testMode) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    store.reset();
    res.json({ ok: true, nextId: store.peekNextId() });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const indexFile = options.distDir && join(options.distDir, 'index.html');
  if (options.distDir && indexFile && existsSync(indexFile)) {
    const template = readFileSync(indexFile, 'utf8');
    if (!template.includes('</head>')) throw new Error(`${indexFile} has no </head> to inject the shop config into`);
    app.use(express.static(options.distDir, { index: false }));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || extname(req.path)) {
        next();
        return;
      }
      // The build is version-agnostic; the version reaches the browser here, on every request.
      const config = JSON.stringify({ version }).replace(/</g, '\\u003c');
      res
        .type('html')
        .set('Cache-Control', 'no-store')
        .send(template.replace('</head>', () => `<script>window.__SHOP__=${config}</script></head>`));
    });
  }

  app.use((_req, res) => {
    res.status(404).type('text').send('Not found');
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: unknown }).status;
    const code = typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
    res.status(code).json({ error: code === 500 ? 'Internal error' : (error as Error).message });
  });

  return app;
}

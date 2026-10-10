import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import type { ShopVersion } from '../shared/variants';
import { assert, ensureUp, h1Text, INPUTS, listOrders, orderStatus, resetStore, v1, v2For } from './flows';

/**
 * P0 acceptance, checked the way a shopper would do it: checkout on v1 and v2, v2-broken confirming
 * an order it never saved, identical UI for v2 and v2-broken, reduced-motion gating, reset per port.
 * Needs the shops running (pnpm shop). Usage: pnpm --filter @hackwave/shop smoke [--headed] [--screenshots <dir>]
 */
const { values } = parseArgs({
  options: {
    headed: { type: 'boolean', default: false },
    screenshots: { type: 'string' },
  },
});
const shotsDir = values.screenshots ? resolve(values.screenshots) : undefined;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const VERSIONS: ShopVersion[] = ['v1', 'v2', 'v2-broken'];
let failures = 0;

async function check(name: string, run: () => Promise<string | void>): Promise<boolean> {
  const started = Date.now();
  try {
    const detail = await run();
    console.log(`  ✓ ${name} (${Date.now() - started} ms)${detail ? `\n      ${detail}` : ''}`);
    return true;
  } catch (error) {
    failures++;
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true });
}

const browser = await chromium.launch({ headless: !values.headed });

async function withPage(run: (page: Page) => Promise<void>, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 800 } });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

async function checkOrder(version: ShopVersion, expectPhone: boolean): Promise<string> {
  const orders = await listOrders(version);
  assert(orders.length === 1, `${version}: expected 1 order in the store, found ${orders.length}`);
  const order = orders[0];
  assert(order, 'unreachable');
  assert(order.id === 4821, `${version}: order id ${order.id}, expected 4821`);
  assert(order.total === 1299, `${version}: total ${order.total}, expected 1299`);
  assert(order.cardLast4 === '4242', `${version}: cardLast4 ${order.cardLast4}, expected 4242`);
  const names = order.items.map((item) => item.name).join(', ');
  assert(names === INPUTS.product, `${version}: items [${names}], expected [${INPUTS.product}]`);
  if (expectPhone) assert(order.shipping.phone === INPUTS.shipping.phone, `${version}: phone not saved`);
  assert((await orderStatus(version, 4821)) === 200, `${version}: GET /api/orders/4821 is not 200`);
  return `store: order ${order.id}, items [${names}], total ${order.total}, card last-4 ${order.cardLast4}`;
}

console.log('shop smoke test');

const up = await check('all three shops are up on their configured ports, in test mode', async () => {
  for (const version of VERSIONS) await ensureUp(version);
});

if (up) {
  await check('v1: a shopper completes checkout and order 4821 lands in the store', async () => {
    await resetStore('v1');
    await withPage(async (page) => {
      await v1.openHome(page);
      await shot(page, 'v1-1-home');
      await v1.addProduct(page);
      await v1.openCart(page);
      await shot(page, 'v1-2-cart');
      await v1.startCheckout(page);
      await v1.fillCheckout(page);
      await shot(page, 'v1-3-checkout');
      // Hold the order request briefly so the double-submit guard is observable.
      await page.route('**/api/orders', async (route) => {
        if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, 400));
        await route.continue();
      });
      const placeOrder = page.getByRole('button', { name: 'Place order', exact: true });
      await placeOrder.click();
      assert(await placeOrder.isDisabled(), 'Place order did not disable itself while the order was in flight');
      await page.getByRole('heading', { level: 1, name: /^Order confirmed #\d+$/ }).waitFor();
      await page.unrouteAll();
      const heading = await h1Text(page);
      assert(heading === 'Order confirmed #4821', `heading "${heading}"`);
      assert(new URL(page.url()).pathname === '/order/4821', `landed on ${page.url()}`);
      await shot(page, 'v1-4-confirmation');
    });
    return await checkOrder('v1', false);
  });

  await check('v2: a shopper completes the redesigned checkout and order 4821 lands in the store', async () => {
    await resetStore('v2');
    const flow = v2For('v2');
    await withPage(async (page) => {
      await flow.openHome(page);
      await shot(page, 'v2-1-home');
      await flow.addProduct(page);
      await flow.openBag(page);
      await shot(page, 'v2-2-bag');
      await flow.proceedToPayment(page);
      await flow.fillShipping(page, { phone: false });
      await flow.continueToPayment(page);
      const alert = page.getByRole('alert');
      await alert.waitFor();
      const alertText = (await alert.textContent()) ?? '';
      assert(alertText.includes('Enter your phone number'), `missing phone gave alert "${alertText}"`);
      await shot(page, 'v2-3-shipping-phone-required');
      await page.getByLabel('Phone', { exact: true }).fill(INPUTS.shipping.phone);
      await flow.continueToPayment(page);
      await page.waitForURL('**/checkout/payment');
      await flow.fillCard(page);
      await shot(page, 'v2-4-payment');
      await flow.pay(page);
      const heading = await h1Text(page);
      assert(heading === 'Thanks! Order ORD-4821 is on its way', `heading "${heading}"`);
      assert(new URL(page.url()).pathname === '/orders/ORD-4821', `landed on ${page.url()}`);
      await shot(page, 'v2-5-confirmation');
    });
    return await checkOrder('v2', true);
  });

  await check('v2-broken: the page confirms ORD-4821, the store has nothing, GET /api/orders/4821 is 404', async () => {
    await resetStore('v2-broken');
    const flow = v2For('v2-broken');
    let heading = '';
    await withPage(async (page) => {
      await flow.openHome(page);
      await flow.addProduct(page);
      await flow.openBag(page);
      await flow.proceedToPayment(page);
      await flow.fillShipping(page, { phone: true });
      await flow.continueToPayment(page);
      await page.waitForURL('**/checkout/payment');
      await flow.fillCard(page);
      await flow.pay(page);
      heading = await h1Text(page);
      await shot(page, 'v2-broken-confirmation');
    });
    assert(heading === 'Thanks! Order ORD-4821 is on its way', `heading "${heading}"`);
    const orders = await listOrders('v2-broken');
    assert(orders.length === 0, `expected an empty store, found ${orders.length} orders`);
    const status = await orderStatus('v2-broken', 4821);
    assert(status === 404, `GET /api/orders/4821 returned ${status}`);
    return `page: "${heading}"; store: 0 orders; GET /api/orders/4821 -> ${status}`;
  });

  await check('v2-broken renders exactly the v2 UI (identical aria snapshots)', async () => {
    const snapshots: string[] = [];
    for (const version of ['v2', 'v2-broken'] as const) {
      await withPage(async (page) => {
        const flow = v2For(version);
        await flow.openHome(page);
        const home = await page.locator('body').ariaSnapshot();
        await flow.addProduct(page);
        await flow.openBag(page);
        const bag = await page.locator('body').ariaSnapshot();
        await flow.proceedToPayment(page);
        const shipping = await page.locator('body').ariaSnapshot();
        snapshots.push([home, bag, shipping].join('\n---\n'));
      });
    }
    assert(snapshots[0] === snapshots[1], 'aria snapshots differ between v2 and v2-broken');
    return 'home, bag dialog and shipping step compared';
  });

  await check('motion is gated on prefers-reduced-motion', async () => {
    async function drawerAnimation(reducedMotion: 'reduce' | 'no-preference'): Promise<string> {
      let animation = '';
      await withPage(async (page) => {
        const flow = v2For('v2');
        await flow.openHome(page);
        await flow.addProduct(page);
        await flow.openBag(page);
        animation = await page
          .getByRole('dialog', { name: 'Your bag' })
          .evaluate((element) => getComputedStyle(element).animationName);
      }, reducedMotion);
      return animation;
    }
    const reduced = await drawerAnimation('reduce');
    const full = await drawerAnimation('no-preference');
    assert(reduced === 'none', `bag drawer animates under reduced motion ("${reduced}")`);
    assert(full === 'v2-slide-in', `bag drawer has no slide-in without reduced motion ("${full}")`);
    return `reduce -> ${reduced}; no-preference -> ${full}`;
  });

  await check('reset clears each store and restarts the counter at 4821', async () => {
    const details: string[] = [];
    for (const version of VERSIONS) {
      const before = (await listOrders(version)).length;
      await resetStore(version);
      const after = (await listOrders(version)).length;
      assert(after === 0, `${version}: ${after} orders left after reset`);
      details.push(`${version}: ${before} -> 0 orders, next id 4821`);
    }
    return details.join('; ');
  });
}

await browser.close();
console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;

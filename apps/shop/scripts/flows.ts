import type { Page } from 'playwright';
import type { Order } from '../shared/order';
import type { ShopVersion } from '../shared/variants';
import { readShopPorts } from '../server/paths';

/** Same values as intents/checkout.json, so a human-style run and an engine run produce the same order. */
export const INPUTS = {
  product: 'Trail Runner',
  card: { number: '4242 4242 4242 4242', expiry: '12/29', cvv: '123', name: 'Kartik Test' },
  shipping: { name: 'Kartik Test', street: '12 MG Road', city: 'Indore', pincode: '452001', phone: '9876543210' },
} as const;

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function shopBase(version: ShopVersion): string {
  const port = readShopPorts()[version];
  assert(port, `No port for ${version} in engine.config.json`);
  return `http://127.0.0.1:${port}`;
}

export async function ensureUp(version: ShopVersion): Promise<void> {
  const base = shopBase(version);
  let health: { version?: string; testMode?: boolean };
  try {
    health = (await (await fetch(`${base}/api/_health`)).json()) as typeof health;
  } catch {
    throw new Error(`${version} is not reachable at ${base}. Start the shops with: pnpm shop`);
  }
  assert(health.version === version, `${base} serves ${health.version}, expected ${version}`);
  assert(health.testMode === true, `${version} is not in test mode (SHOP_TEST_MODE=1)`);
}

export async function resetStore(version: ShopVersion): Promise<void> {
  const response = await fetch(`${shopBase(version)}/api/_test/reset`, { method: 'POST' });
  const body = (await response.json()) as { ok?: boolean; nextId?: number };
  assert(response.ok && body.ok && body.nextId === 4821, `reset on ${version} failed: ${JSON.stringify(body)}`);
}

export async function listOrders(version: ShopVersion): Promise<Order[]> {
  return (await (await fetch(`${shopBase(version)}/api/orders`)).json()) as Order[];
}

export async function orderStatus(version: ShopVersion, id: number): Promise<number> {
  return (await fetch(`${shopBase(version)}/api/orders/${id}`)).status;
}

export async function h1Text(page: Page): Promise<string> {
  return ((await page.getByRole('heading', { level: 1 }).textContent()) ?? '').trim();
}

async function openHome(page: Page, version: ShopVersion): Promise<void> {
  await page.goto(`${shopBase(version)}/`);
  await page.getByRole('article', { name: INPUTS.product }).waitFor();
}

async function addProduct(page: Page): Promise<void> {
  await page.getByRole('article', { name: INPUTS.product }).getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('status').filter({ hasText: `${INPUTS.product} added` }).waitFor();
}

async function fillCard(page: Page): Promise<void> {
  await page.getByLabel('Card number', { exact: true }).fill(INPUTS.card.number);
  await page.getByLabel('Expiry (MM/YY)', { exact: true }).fill(INPUTS.card.expiry);
  await page.getByLabel('CVV', { exact: true }).fill(INPUTS.card.cvv);
  await page.getByLabel('Name on card', { exact: true }).fill(INPUTS.card.name);
}

async function fillAddress(page: Page): Promise<void> {
  await page.getByLabel('Full name', { exact: true }).fill(INPUTS.shipping.name);
  await page.getByLabel('Street address', { exact: true }).fill(INPUTS.shipping.street);
  await page.getByLabel('City', { exact: true }).fill(INPUTS.shipping.city);
  await page.getByLabel('Pincode', { exact: true }).fill(INPUTS.shipping.pincode);
}

/** v1 as a shopper walks it, with semantic locators only. */
export const v1 = {
  openHome: (page: Page) => openHome(page, 'v1'),
  addProduct,
  async openCart(page: Page): Promise<void> {
    await page.getByRole('button', { name: /^Cart \(\d+\)$/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Your cart' }).waitFor();
  },
  async startCheckout(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Checkout', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: 'Checkout' }).waitFor();
  },
  async fillCheckout(page: Page): Promise<void> {
    await fillCard(page);
    await fillAddress(page);
  },
  async placeOrder(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Place order', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: /^Order confirmed #\d+$/ }).waitFor();
  },
};

/** v2 as a shopper walks it: bag dialog, shipping step with phone, payment step. */
export function v2For(version: Extract<ShopVersion, 'v2' | 'v2-broken' | 'v2-wrong-total'>) {
  return {
    openHome: (page: Page) => openHome(page, version),
    addProduct,
    async openBag(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'Your bag', exact: true }).click();
      await page.getByRole('dialog', { name: 'Your bag' }).waitFor();
    },
    async proceedToPayment(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'Proceed to payment', exact: true }).click();
      await page.waitForURL('**/checkout/shipping');
    },
    async fillShipping(page: Page, options: { phone: boolean }): Promise<void> {
      await fillAddress(page);
      if (options.phone) await page.getByLabel('Phone', { exact: true }).fill(INPUTS.shipping.phone);
    },
    async continueToPayment(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
    },
    fillCard,
    async pay(page: Page): Promise<void> {
      await page.getByRole('button', { name: 'Pay ₹1,299', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: /^Thanks! Order ORD-\d+ is on its way$/ }).waitFor();
    },
  };
}

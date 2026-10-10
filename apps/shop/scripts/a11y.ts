import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from 'playwright';
import type { ShopVersion } from '../shared/variants';
import { ensureUp, resetStore, shopBase, v1, v2For } from './flows';

/**
 * P0 acceptance: an axe scan through Playwright of every page state of v1, v2 and v2-broken.
 * Fails on any critical violation; prints every violation of any impact.
 * Needs the shops running (pnpm shop). Usage: pnpm --filter @hackwave/shop a11y
 */
type Impact = 'critical' | 'serious' | 'moderate' | 'minor';
const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

interface Finding {
  where: string;
  id: string;
  impact: Impact;
  help: string;
  targets: string[];
}

const scanned: string[] = [];
const findings: Finding[] = [];

async function scan(page: Page, version: ShopVersion, state: string): Promise<void> {
  const where = `${version} ${state}`;
  const { violations } = await new AxeBuilder({ page }).analyze();
  for (const violation of violations) {
    findings.push({
      where,
      id: violation.id,
      impact: (violation.impact ?? 'minor') as Impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.map(String).join(' ')),
    });
  }
  scanned.push(where);
}

async function scanV1(page: Page): Promise<void> {
  await v1.openHome(page);
  await scan(page, 'v1', 'home');
  await v1.addProduct(page);
  await scan(page, 'v1', 'home, item added');
  await v1.openCart(page);
  await scan(page, 'v1', 'cart');
  await v1.startCheckout(page);
  await scan(page, 'v1', 'checkout');
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await scan(page, 'v1', 'checkout, validation errors');
  await v1.fillCheckout(page);
  await v1.placeOrder(page);
  await scan(page, 'v1', 'confirmation');
  await v1.openCart(page);
  await scan(page, 'v1', 'cart, empty');
  await page.goto(`${shopBase('v1')}/no-such-page`);
  await page.getByRole('heading', { level: 1, name: 'Page not found' }).waitFor();
  await scan(page, 'v1', 'not found');
}

async function scanV2(page: Page, version: 'v2' | 'v2-broken'): Promise<void> {
  const flow = v2For(version);
  await flow.openHome(page);
  await scan(page, version, 'home');
  await flow.addProduct(page);
  await scan(page, version, 'home, item added');
  await flow.openBag(page);
  await scan(page, version, 'bag dialog');
  await flow.proceedToPayment(page);
  await scan(page, version, 'shipping');
  await flow.continueToPayment(page);
  await page.getByRole('alert').waitFor();
  await scan(page, version, 'shipping, validation errors');
  await flow.fillShipping(page, { phone: true });
  await flow.continueToPayment(page);
  await page.waitForURL('**/checkout/payment');
  await scan(page, version, 'payment');
  await page.getByRole('button', { name: /^Pay / }).click();
  await page.getByRole('alert').waitFor();
  await scan(page, version, 'payment, validation errors');
  await flow.fillCard(page);
  await flow.pay(page);
  await scan(page, version, 'confirmation');
  await flow.openBag(page);
  await scan(page, version, 'bag dialog, empty');
  await page.goto(`${shopBase(version)}/no-such-page`);
  await page.getByRole('heading', { level: 1, name: 'Page not found' }).waitFor();
  await scan(page, version, 'not found');
}

const versions: ShopVersion[] = ['v1', 'v2', 'v2-broken'];
for (const version of versions) await ensureUp(version);
for (const version of versions) await resetStore(version);

const browser = await chromium.launch();
try {
  for (const version of versions) {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    if (version === 'v1') await scanV1(page);
    else await scanV2(page, version as 'v2' | 'v2-broken');
    await context.close();
  }
} finally {
  await browser.close();
  for (const version of versions) await resetStore(version);
}

console.log(`axe scan: ${scanned.length} page states\n`);
console.log(`${'page state'.padEnd(40)}${IMPACTS.map((impact) => impact.padStart(10)).join('')}`);
for (const where of scanned) {
  const counts = IMPACTS.map((impact) =>
    String(findings.filter((f) => f.where === where && f.impact === impact).length).padStart(10),
  );
  console.log(`${where.padEnd(40)}${counts.join('')}`);
}

if (findings.length > 0) {
  console.log('\nviolations:');
  for (const finding of findings) {
    console.log(`  [${finding.impact}] ${finding.where}: ${finding.id} - ${finding.help}`);
    for (const target of finding.targets) console.log(`      ${target}`);
  }
}

const totals = IMPACTS.map((impact) => `${findings.filter((f) => f.impact === impact).length} ${impact}`).join(', ');
const critical = findings.filter((f) => f.impact === 'critical').length;
console.log(`\naxe: ${totals}`);
process.exitCode = critical === 0 ? 0 : 1;

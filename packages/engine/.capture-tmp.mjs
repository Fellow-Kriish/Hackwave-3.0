// Recapture: Reports at phone width after one offline guided-preset run.
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4321';
for (let i = 0; i < 60; i++) {
  try { await fetch(`${base}/api/state`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}
const state = await (await fetch(`${base}/api/state`)).json();
await fetch(`${base}/api/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: state.defaultGoal }) });
for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  const now = await (await fetch(`${base}/api/state`)).json();
  if (now.batches[0]?.done) { console.log(now.batches[0].runs.map((r) => `${r.code} ${r.color}`).join(', ')); break; }
}
const browser = await chromium.launch();
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(`${base}/#reports`);
await phone.waitForSelector('#repBody:not([hidden])');
await phone.waitForTimeout(1500);
await phone.screenshot({ path: '.impeccable/review/mobile.png', fullPage: true });
console.log('scrollWidth', await phone.evaluate(() => document.documentElement.scrollWidth));
await browser.close();

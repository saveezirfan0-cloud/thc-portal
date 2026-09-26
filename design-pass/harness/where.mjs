// node design-pass/harness/where.mjs <screen> <width> <css selector> — page y of the first match.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const req = createRequire(join(WT, 'apps/office/package.json'));
const { chromium } = req('playwright-core');
const [screen, w, selector] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({
  viewport: { width: +w, height: 844 },
  isMobile: +w < 760,
  hasTouch: +w < 760,
});
await page.goto('file://' + join(H, 'out', screen + '.html'));
await page.waitForTimeout(150);
const y = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
}, selector);
console.log(y, await page.evaluate(() => document.documentElement.scrollHeight));
await browser.close();

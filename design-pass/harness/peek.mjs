// node design-pass/harness/peek.mjs <screen> [width=390] [theme=light] [tileHeight=1100]
// Writes readable tiles of a full-page render to design-pass/peek/.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const req = createRequire(join(WT, 'apps/office/package.json'));
const { chromium } = req('playwright-core');
const [name, w = '390', theme = 'light', th = '1100', mode = 'tiles'] = process.argv.slice(2);
const width = +w;
const tile = +th;
const out = join(WT, 'design-pass', 'peek');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out))
  if (f.startsWith(`${name}-${width}-${theme}-`)) rmSync(join(out, f));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: width < 760,
  isMobile: width < 760,
});
const page = await ctx.newPage();
await page.goto('file://' + join(H, 'out', name + '.html'));
await page.evaluate(
  ([t, m]) => {
    document.documentElement.setAttribute('data-theme', t);
    if (m === 'viewport') return;
    // The fixed tab bar would sit over the middle of a full-page capture.
    const s = document.createElement('style');
    s.textContent = '.pnav-bar{position:static!important}';
    document.head.append(s);
  },
  [theme, mode],
);
await page.waitForTimeout(150);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
let i = 0;
if (mode === 'viewport') {
  // What the reader sees mid-scroll: sticky and fixed chrome in place.
  for (const at of [0.35, 0.7]) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(total * at));
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(out, `${name}-${width}-${theme}-${i++}.png`) });
  }
  console.log(name, 'viewport shots', i);
  await browser.close();
  process.exit(0);
}
for (let y = 0; y < total; y += tile) {
  await page.screenshot({
    path: join(out, `${name}-${width}-${theme}-${i++}.png`),
    fullPage: true,
    clip: { x: 0, y, width, height: Math.min(tile, total - y) },
  });
}
console.log(name, 'tiles', i, 'height', total);
await browser.close();

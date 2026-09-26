// node design-pass/harness/probe.mjs <screen> <width> <selector> — widths of the match and its ancestors.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const { chromium } = createRequire(join(WT, 'apps/office/package.json'))('playwright-core');
const [screen, w, selector] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: +w, height: 844 } });
await page.goto('file://' + join(H, 'out', screen + '.html'));
console.log(
  await page.evaluate((sel) => {
    const out = [];
    for (let el = document.querySelector(sel); el; el = el.parentElement) {
      const s = getComputedStyle(el);
      out.push(
        `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} w=${Math.round(el.getBoundingClientRect().width)} sw=${el.scrollWidth} disp=${s.display} ovx=${s.overflowX} minw=${s.minWidth}`,
      );
    }
    return out.join('\n');
  }, selector),
);
await browser.close();

// node design-pass/harness/shoot.mjs <outdir> [screen ...]
// Screenshots every rendered screen at 390 and 820, light and dark, and
// prints the layout faults it can measure.
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const req = createRequire(join(WT, 'apps/office/package.json'));
const { chromium } = req('playwright-core');

const outDir = join(WT, 'design-pass', process.argv[2] ?? 'after');
mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(3);
const screens = readdirSync(join(H, 'out'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''))
  .filter((n) => only.length === 0 || only.includes(n));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const report = {};
for (const width of [390, 820]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: width === 390 ? 2 : 1,
    hasTouch: width === 390,
    isMobile: width === 390,
  });
  const page = await ctx.newPage();
  for (const name of screens) {
    for (const theme of ['light', 'dark']) {
      await page.goto('file://' + join(H, 'out', name + '.html'));
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(150);
      const faults = await page.evaluate(() => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw + 1)
          out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
        const describe = (el) => {
          const cls =
            typeof el.className === 'string'
              ? el.className.trim().split(/\s+/).slice(0, 3).join('.')
              : '';
          const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} "${text}"`;
        };
        const inScroller = (el) => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (
              /(auto|scroll)/.test(s.overflowX) &&
              p !== document.documentElement &&
              p !== document.body
            )
              return true;
            if (s.display === 'none') return true;
          }
          return false;
        };
        // Off the right edge (and not inside a sideways scroller).
        for (const el of document.querySelectorAll('.content *, .cwrap *, .topbar *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1 && !inScroller(el) && getComputedStyle(el).position !== 'fixed')
            out.push(`overflows right (${Math.round(r.right)}): ${describe(el)}`);
        }
        // Squeezed text: an element whose text wraps one or two characters a line.
        for (const el of document.querySelectorAll('.content *, .cwrap *')) {
          if (el.children.length) continue;
          const txt = (el.textContent || '').trim();
          if (txt.length < 5) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          const lh =
            parseFloat(getComputedStyle(el).lineHeight) ||
            parseFloat(getComputedStyle(el).fontSize) * 1.3;
          const lines = Math.round(r.height / lh);
          if (lines >= 3 && r.width < 60)
            out.push(`squeezed (${Math.round(r.width)}px, ${lines} lines): ${describe(el)}`);
        }
        // Touch targets.
        const small = [];
        for (const el of document.querySelectorAll(
          '.content :is(a, button, select, input:not([type=hidden]), textarea, [role=button], [role=tab]), .cwrap :is(a, button, select, input:not([type=hidden]), [role=button], [role=tab]), .topbar :is(a, button), .ctop :is(a, button)',
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.closest('.tbl') && el.tagName === 'A' && !el.classList.contains('btn')) continue;
          if (r.height < 44 && !(el.type === 'checkbox' || el.type === 'radio'))
            small.push(`${Math.round(r.height)}px ${describe(el)}`);
        }
        return { out, small };
      });
      const key = `${name}@${width}-${theme}`;
      report[key] = faults;
      const file = join(outDir, `${name}-${width}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
for (const [k, v] of Object.entries(report)) {
  if (!k.includes('light')) continue;
  console.log(`\n== ${k}`);
  for (const l of [...new Set(v.out)].slice(0, 25)) console.log('  ' + l);
  if (k.includes('390'))
    console.log(`  touch <44: ${v.small.length}`, [...new Set(v.small)].slice(0, 8).join(' | '));
}

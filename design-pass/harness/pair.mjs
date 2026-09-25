// node design-pass/harness/pair.mjs <out-name> <screen> <width> <theme> <y> <height> [afterScreen]
// Crops the same region of the before and after full-page shots and lays
// them side by side, at 1x, into design-pass/key/<out-name>.png.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const req = createRequire(join(WT, 'apps/office/package.json'));
const { chromium } = req('playwright-core');
const [out, screen, w, theme, y, h, afterScreen] = process.argv.slice(2);
const width = +w;
const before = join(WT, 'design-pass/before', `${screen}-${width}-${theme}.png`);
const after = join(WT, 'design-pass/after', `${afterScreen ?? screen}-${width}-${theme}.png`);
// `y` is one offset for both, or `before:after` when the layout moved.
const [yBefore, yAfter = yBefore] = y.split(':');
const panes = [
  ['before', before, yBefore],
  ['after', after, yAfter],
].filter(([, p]) => existsSync(p));
const html = `<!doctype html><html><body style="margin:0;background:#888;font:600 13px system-ui;display:flex;gap:8px;padding:8px">
${panes
  .map(
    ([label, p, top]) => `<div><div style="padding:4px 0;color:#fff">${label}</div>
<div style="width:${width}px;height:${h}px;overflow:hidden;background:#fff"><img src="file://${p}" style="width:${width}px;display:block;margin-top:-${top}px"></div></div>`,
  )
  .join('\n')}</body></html>`;
const tmp = join(H, 'out', '_pair.html');
writeFileSync(tmp, html);
mkdirSync(join(WT, 'design-pass/key'), { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: width * 2 + 40, height: +h + 60 } });
await page.goto('file://' + tmp);
await page.waitForTimeout(200);
await page.screenshot({ path: join(WT, 'design-pass/key', out + '.png'), fullPage: true });
await browser.close();
console.log('wrote', out);

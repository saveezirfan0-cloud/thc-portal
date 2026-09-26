// vite-node design-pass/harness/render.mjs <screen>
// Renders one screen (page.tsx + fixtures) to design-pass/harness/out/<screen>.html
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { prerender } from 'react-dom/static';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.TZ = 'Europe/London';

const name = process.argv[2];
const screens = (await import('./screens.mjs')).default;
const s = screens[name];
if (!s) throw new Error('unknown screen ' + name);
globalThis.__db = s.db ?? {};
globalThis.__pathname = s.pathname ?? '/';
globalThis.__search = new URLSearchParams(s.search ?? {}).toString();

globalThis.__patch = s.patch ?? [];
if (s.setup) await s.setup();

let el;
if (s.page) {
  const mod = await import(join(WT, s.page));
  el = await mod.default({
    params: Promise.resolve(s.params ?? {}),
    searchParams: Promise.resolve(s.search ?? {}),
  });
} else {
  el = await s.element();
}
for (const l of [...(s.layouts ?? [])].reverse()) {
  const L = (await import(join(WT, l))).default;
  el = await L({ children: el });
}
if (s.app === 'office') {
  const { SignedInAsProvider } = await import(
    join(WT, 'apps/office/app/_components/SignedInAs.tsx')
  );
  const { NavCountsProvider } = await import(
    join(WT, 'apps/office/app/_components/OfficeSidebar.tsx')
  );
  el = createElement(
    SignedInAsProvider,
    { user: { name: 'Sarah Mitchell', role: 'Operations manager' } },
    createElement(NavCountsProvider, { counts: { compliance: 3, onboarding: 12 } }, el),
  );
}

const { prelude } = await prerender(el, {
  onError(e) {
    console.error('render error', e);
  },
});
const reader = prelude.getReader();
let html = '';
const dec = new TextDecoder();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  html += dec.decode(value);
}
const css = [
  join(WT, 'packages/ui/src/styles/index.css'),
  ...(globalThis.__css ?? []).filter((p) => !p.includes('packages/ui/src/styles')),
]
  .map((p) => `<link rel="stylesheet" href="file://${p}">`)
  .join('\n');
const doc = `<!doctype html><html lang="en-GB" data-style="warm" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css}</head><body>${html}</body></html>`;
writeFileSync(join(H, 'out', name + '.html'), doc);
console.log('wrote', name, html.length, 'bytes;', (globalThis.__css ?? []).length, 'css');
process.exit(0);

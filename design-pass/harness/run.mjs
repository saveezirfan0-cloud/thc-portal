// node design-pass/harness/run.mjs [screen ...] — renders each screen in its own process.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const VN = join(
  WT,
  'node_modules/.pnpm/vite-node@3.2.4_@types+node@26.6.2/node_modules/vite-node/vite-node.mjs',
);
const screens = (await import('./screens.mjs')).default;
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(screens);
let failed = 0;
for (const n of names) {
  const r = spawnSync(
    process.execPath,
    [VN, '--config', join(H, 'vite.config.mjs'), join(H, 'render.mjs'), n],
    { cwd: WT, encoding: 'utf8', env: { ...process.env, TZ: 'Europe/London' } },
  );
  const out = (r.stdout + r.stderr).trim().split('\n');
  const ok = r.status === 0 && !/render error/.test(r.stdout + r.stderr);
  if (!ok) failed++;
  console.log(ok ? 'ok  ' : 'FAIL', n, ok ? out.at(-1) : '\n' + out.slice(0, 30).join('\n'));
}
process.exit(failed ? 1 : 0);

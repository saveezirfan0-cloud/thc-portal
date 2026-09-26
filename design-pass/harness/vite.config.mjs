// Static render harness for the phone pass: renders each screen's real
// markup (page.tsx with its data loader swapped for a fixture) and collects
// the CSS files the route imports, so Playwright can screenshot it.
import { createRequire } from 'node:module';
import { realpathSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const H = dirname(new URL(import.meta.url).pathname);
const WT = join(H, '..', '..');
const req = createRequire(join(WT, 'apps/office/package.json'));
const reactDir = dirname(realpathSync(req.resolve('react/package.json')));
const reactDomDir = dirname(realpathSync(req.resolve('react-dom/package.json')));
const FIX = join(H, 'fixtures');

export default {
  root: WT,
  esbuild: { jsx: 'automatic' },
  server: { fs: { strict: false } },
  resolve: {
    alias: [
      { find: /^react$/, replacement: join(reactDir, 'index.js') },
      { find: /^react\/(.*)$/, replacement: reactDir + '/$1' },
      { find: /^react-dom$/, replacement: join(reactDomDir, 'index.js') },
      { find: /^react-dom\/(.*)$/, replacement: reactDomDir + '/$1' },
      { find: /^server-only$/, replacement: join(H, 'stubs/empty.mjs') },
      { find: /^next\/link$/, replacement: join(H, 'stubs/next-link.mjs') },
      { find: /^next\/navigation$/, replacement: join(H, 'stubs/next-navigation.mjs') },
      { find: /^next\/headers$/, replacement: join(H, 'stubs/next-headers.mjs') },
      { find: /^next\/cache$/, replacement: join(H, 'stubs/next-cache.mjs') },
      { find: /^next\/dynamic$/, replacement: join(H, 'stubs/next-dynamic.mjs') },
      { find: /^next\/server$/, replacement: join(H, 'stubs/next-server.mjs') },
      { find: /^@thc\/db\/server$/, replacement: join(H, 'stubs/db-server.mjs') },
      { find: /^@thc\/db\/admin$/, replacement: join(H, 'stubs/db-server.mjs') },
      { find: /^@thc\/db\/browser$/, replacement: join(H, 'stubs/db-server.mjs') },
    ],
  },
  plugins: [
    {
      name: 'harness',
      enforce: 'pre',
      async resolveId(source, importer, opts) {
        if (source.endsWith('.css')) {
          const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
          return r ? '\0css:' + encodeURIComponent(r.id) + '.mjs' : null;
        }
        if (!importer || importer.startsWith(FIX)) return null;
        if (/(^|\/)[A-Za-z-]*(data|actions|Data|Actions)(\.ts)?$/.test(source)) {
          const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
          if (r && r.id.startsWith(WT + '/apps/')) {
            const fx = join(FIX, relative(WT, r.id));
            if (existsSync(fx)) return fx;
          }
        }
        return null;
      },
      transform(code, id) {
        const patches = globalThis.__patch ?? [];
        let out = code;
        for (const [file, from, to] of patches) if (id.endsWith(file)) out = out.replace(from, to);
        return out === code ? null : out;
      },
      load(id) {
        if (id.startsWith('\0css:')) {
          const p = decodeURIComponent(id.slice(5, -4));
          return `globalThis.__css ??= []; if (!globalThis.__css.includes(${JSON.stringify(p)})) globalThis.__css.push(${JSON.stringify(p)}); export default '';`;
        }
        return null;
      },
    },
  ],
};

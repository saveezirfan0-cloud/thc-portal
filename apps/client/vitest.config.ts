import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

/**
 * The app tsconfigs set `jsx: "preserve"`, because Next compiles the JSX.
 * Vitest has no Next in front of it, so it needs to be told to transform
 * JSX itself — without this a `.tsx` test fails on the first `<`.
 *
 * `server-only` is the second thing Next normally stands in for. The
 * package's `default` export condition throws by design ("cannot be
 * imported from a Client Component"), and Vitest resolves that condition,
 * so any test that transitively loads `@thc/db/server` or `@thc/db/admin`
 * dies on import. Next ships an empty stand-in for exactly this; the alias
 * has to be an absolute path, because a bare `next/...` replacement is
 * re-resolved from packages/db, which has no `next`.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'server-only': createRequire(import.meta.url).resolve(
        'next/dist/compiled/server-only/empty.js',
      ),
    },
  },
});

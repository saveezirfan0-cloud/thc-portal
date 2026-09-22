import { defineConfig } from 'vitest/config';

/**
 * The app tsconfigs set `jsx: "preserve"`, because Next compiles the JSX.
 * Vitest has no Next in front of it, so it needs to be told to transform
 * JSX itself — without this a `.tsx` test fails on the first `<`.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
});

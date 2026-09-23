import { defineConfig } from 'vitest/config';

/**
 * `SheetDocument.tsx` is JSX for @react-pdf/renderer. The package tsconfig
 * says `react-jsx`; this tells Vitest's esbuild the same, so the render
 * tests draw a real PDF rather than failing on the first `<`.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
});

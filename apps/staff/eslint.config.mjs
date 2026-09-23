import root from '../../eslint.config.mjs';

/**
 * The root flat config, plus the one thing only this app has: a GENERATED
 * service worker.
 *
 * `public/sw.js` is @serwist/next's build output (next.config.ts) — minified,
 * committed to nobody (apps/staff/.gitignore) and rebuilt on every `next
 * build`. Linting it produced 131 errors about `==` in code no human wrote,
 * and — worse — those errors only appear AFTER a build, so `pnpm lint` passed
 * or failed depending on what you had run before it.
 */
export default [
  ...root,
  { ignores: ['public/sw.js', 'public/sw.js.map', 'public/swe-worker-*.js'] },
];

import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

/**
 * The Staff App is the PWA (ADR-0001, docs/06). `sw.ts` is compiled to
 * `public/sw.js` at build time with the precache manifest injected.
 *
 * Disabled in `next dev`: the dev server rebuilds chunks on every keystroke
 * and a service worker holding the previous ones is an afternoon lost to
 * phantom hydration errors. Everything the PWA is judged on — installability,
 * offline, push — is judged on `next build && next start`, which is also
 * what the e2e suite runs.
 */
const withSerwist = withSerwistInit({
  swSrc: 'sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  // The precache manifest @serwist/next builds covers `_next/static` and
  // `public/`, which are assets — no PAGE is in it. /offline is a page, and
  // it is the one the service worker serves when the network is gone, so it
  // has to be named here or the fallback resolves to nothing and a worker
  // underground gets the browser's error page instead of ours.
  //
  // A fresh revision per build: the offline shell must not be the one from
  // three deploys ago.
  additionalPrecacheEntries: [{ url: '/offline', revision: crypto.randomUUID() }],
  // The SW must not be cached by the CDN for longer than a deploy, or an
  // updated worker waits behind a stale one.
  cacheOnNavigation: true,
  reloadOnOnline: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: { APP_TZ: process.env.APP_TZ ?? 'Europe/London' },
};

export default withSerwist(nextConfig);

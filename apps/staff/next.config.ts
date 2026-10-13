import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import { securityHeaderRules } from '@thc/db/security-headers';

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
  // Off. `cacheOnNavigation` makes every client-side navigation post its URL
  // to the worker, which then fetches and stores the page — a signed-in
  // worker's shifts, documents and payment details, left in Cache Storage on
  // a shared or lost phone after sign-out. The offline shell is precached
  // above; pages are not. (Nothing to do with the CDN: Vercel already serves
  // sw.js revalidated on every load.)
  cacheOnNavigation: false,
  reloadOnOnline: true,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Framing, sniffing, referrer, permissions (location and camera for check-in
  // and the selfie), HSTS — packages/db/src/security-headers.ts. sw.js gets
  // them too, harmlessly: none restricts what a worker script may fetch.
  headers: async () => securityHeaderRules('staff'),
  transpilePackages: ['@thc/ui', '@thc/domain', '@thc/db', '@thc/notifications'],
  env: {
    APP_TZ: process.env.APP_TZ ?? 'Europe/London',
    // ADR-0032: the Staff App has no "Keep me signed in" box, so a device
    // with no preference keeps @supabase/ssr's own cookie lifetime. Read by
    // the server and browser Supabase clients (packages/db/src/session.ts);
    // leaving it out caps workers at the Back Office's 30 days, not worse.
    THC_AUTH_COOKIE_FALLBACK: 'library',
  },
};

export default withSerwist(nextConfig);

/**
 * What the Staff App's service worker (sw.ts) may keep — security round
 * 12.10, item 2. Pure, so it is tested without a worker.
 */

/**
 * What MAY be cached from this origin: the build's own content-hashed
 * assets and the files in `public/` — fonts, icons, the induction slides,
 * scripts and styles. Nothing a worker's session decides.
 *
 * Deliberately not `/_next/image` (it proxies whatever URL it is handed,
 * which could be a signed photo), not `/_next/data` or `/api/`, and not
 * anything a route handler answers — `/shifts/<id>/calendar.ics` is a
 * worker's own shift, and `defaultCache`'s same-origin catch-all ("others")
 * and its `.json|.xml|.csv` rule ("static-data-assets") would keep those.
 */
const STATIC_ASSET = /\.(?:js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|avif)$/i;
export function isStaticAsset(url: URL): boolean {
  const path = url.pathname;
  if (path.startsWith('/_next/static/')) return true;
  if (path.startsWith('/_next/') || path.startsWith('/api/') || path.startsWith('/auth/')) {
    return false;
  }
  return STATIC_ASSET.test(path);
}

/**
 * Runtime caches an earlier build of this worker (or of `defaultCache`)
 * could have filled with personal data. Deleted on every activate, so a
 * phone that ran the old worker keeps none of it. The precache (the
 * offline shell), the static-asset caches and the app-badge count
 * (`thc-app-badge`) are left alone.
 */
export const PERSONAL_CACHES = [
  'pages',
  'pages-rsc',
  'pages-rsc-prefetch',
  'others',
  'cross-origin',
  'start-url',
  'apis',
  'next-data',
  'next-image',
  'static-data-assets',
] as const;

export async function deletePersonalCaches(storage: CacheStorage): Promise<void> {
  const names = await storage.keys();
  await Promise.all(
    names
      .filter((name) => (PERSONAL_CACHES as readonly string[]).includes(name))
      .map((name) => storage.delete(name)),
  );
}

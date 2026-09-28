/**
 * The red count on the Staff App's home-screen icon — §8, §10.5.
 *
 * The Badging API (`navigator.setAppBadge`) paints the same red dot a
 * native app gets: iOS/iPadOS 16.4+ for a web app added to the home
 * screen with notifications allowed, Android Chrome (as a dot or a count,
 * the launcher decides) and installed desktop Chrome/Edge. Where it does
 * not exist this module does nothing — the notification itself still
 * arrives, it just leaves no number on the icon.
 *
 * What the number means: pushes that have arrived since the worker last
 * had the app open. Opening the app (or bringing it back to the front)
 * clears it, as a messaging app does — they have seen what the app has to
 * say. A push that replaces one already on screen (same `tag`, e.g. a
 * re-sent N8 for the same document) is the same item, not a new one.
 *
 * Why the count is stored and not derived: a service worker keeps no
 * memory between wake-ups, and `getNotifications()` counts what is still
 * in the notification centre, which includes pushes read in the app an
 * hour ago. Cache Storage is the one store both the worker and the page
 * can reach with no extra dependency, so the count lives there — one tiny
 * entry, never a page, so nothing here conflicts with "never cache a page"
 * in sw.ts.
 */

/** The cache and the key the count lives under. Not a real URL. */
export const BADGE_CACHE = 'thc-app-badge';
const BADGE_KEY = '/__thc/app-badge';

/** The Badging API, where the platform has it (Window and worker alike). */
export interface BadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

async function readCount(caches: CacheStorage): Promise<number> {
  const cache = await caches.open(BADGE_CACHE);
  const hit = await cache.match(BADGE_KEY);
  if (!hit) return 0;
  const n = Number.parseInt(await hit.text(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function writeCount(caches: CacheStorage, n: number): Promise<void> {
  const cache = await caches.open(BADGE_CACHE);
  await cache.put(BADGE_KEY, new Response(String(n)));
}

async function paint(nav: BadgeNavigator, n: number): Promise<void> {
  if (n > 0) await nav.setAppBadge?.(n);
  else await nav.clearAppBadge?.();
}

/**
 * Two pushes can land in the same wake-up; a read-then-write each would
 * both read 3 and both write 4. One queue per scope makes it 5.
 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * One more unread push. Called by the service worker's `push` handler.
 * Never throws: a badge that failed to paint must not take the
 * notification down with it (iOS revokes subscriptions whose pushes show
 * nothing).
 */
export function bumpAppBadge(nav: BadgeNavigator, caches: CacheStorage): Promise<number> {
  return serial(async () => {
    try {
      const n = (await readCount(caches)) + 1;
      await writeCount(caches, n);
      await paint(nav, n);
      return n;
    } catch {
      return 0;
    }
  }).catch(() => 0);
}

/** The worker has the app open: nothing is unread. Never throws. */
export function clearAppBadge(
  nav: BadgeNavigator,
  caches: CacheStorage | undefined,
): Promise<void> {
  return serial(async () => {
    try {
      if (caches) await writeCount(caches, 0);
    } catch {
      // No Cache Storage (a private window) — still take the dot off.
    }
    try {
      await nav.clearAppBadge?.();
    } catch {
      // Nothing to clear, or no permission to badge. Either way, harmless.
    }
  }).catch(() => undefined);
}

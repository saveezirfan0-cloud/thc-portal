/**
 * The Staff App's service worker — Scope §10.5, ADR-0001 (docs/06).
 *
 * Two jobs, in the order they matter to a worker standing outside a
 * venue on one bar of signal:
 *
 *   1. Receive Web Push with the app closed. This is the whole of §8 on a
 *      PWA: N1–N15 are device-level, and on iOS they only arrive at all
 *      once the app is installed to the home screen (16.4+). That is why
 *      /install exists and why it is not decoration.
 *   2. Serve the app shell offline, so opening the app on the Underground
 *      shows the shell and an honest "you are offline" rather than the
 *      browser's dinosaur.
 *
 * There is NO offline check-in queue, and nothing here pretends to be one.
 * The scope does not require it, and a check-in or check-out is decided by
 * the server at the moment of the press (§5.1) — the grace, the lock and
 * the geofence all read `now()`. /offline says so plainly: check-in and
 * check-out need a connection (docs/15).
 *
 * Compiled by @serwist/next at build time into public/sw.js. Nothing in
 * this file runs in a window: `self` is the ServiceWorkerGlobalScope.
 */
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Where a push with no deep link of its own opens (§10.4). */
const HOME = '/shifts';

/** The offline shell. Precached, so it is there when nothing else is. */
const OFFLINE = '/offline';

/**
 * NEVER cache a page. Every HTML document and every RSC payload this app
 * serves is personal, signed-in and state-dependent: the app lock (§10.1)
 * is computed per request from `staff_me()`, so the same URL is a working
 * Shifts screen for one worker and a "your account is on hold" screen for
 * the next.
 *
 * `defaultCache` from `@serwist/next` routes both through `NetworkFirst`
 * (cacheName "others" for documents — its "html" matcher tests the REQUEST's
 * Content-Type, which a navigation does not send, so documents fall through
 * to it — and "pages-rsc"/"pages-rsc-prefetch" for flight payloads), each
 * keeping 32 entries for 24 hours. NetworkFirst only serves the cache when
 * the network FAILS, which is precisely when it does the most damage:
 *
 *   · a worker unblocked at 08:00 (§4.3 unblocks automatically on the
 *     office's Verify) reopens the app in a basement and is shown last
 *     night's locked screen, with no way to tell it is stale;
 *   · two workers share a phone — the case `save_push_subscription` exists
 *     to handle — and the second one's first load on a bad connection
 *     renders the first one's name, employee ID and shift list.
 *
 * The Cache API stores whatever it is given; `Cache-Control: private,
 * no-store` on a dynamic Next response does not stop a service worker
 * caching it. So the rule has to be here.
 *
 * NetworkOnly, and INSIDE `runtimeCaching` rather than through
 * `registerCapture`: Serwist attaches the `PrecacheFallbackPlugin` to
 * `runtimeCaching` handlers only (Serwist.ts), so a route registered any
 * other way would lose the /offline fallback and give a disconnected
 * worker the browser's error page instead of ours. First match wins, so
 * this sits ahead of `defaultCache`.
 *
 * Static assets are untouched: `_next/static` is content-hashed and
 * immutable, and it is what makes the offline shell render at all.
 */
const PAGES_ARE_NEVER_CACHED = {
  matcher: ({ request, sameOrigin }: { request: Request; sameOrigin: boolean }) =>
    sameOrigin && (request.mode === 'navigate' || request.headers.get('RSC') === '1'),
  handler: new NetworkOnly(),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A worker must never be looking at a stale build of the check-in screen:
  // the times and the rules in it change. Take over as soon as we can.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [PAGES_ARE_NEVER_CACHED, ...defaultCache],
  fallbacks: {
    entries: [
      {
        url: OFFLINE,
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
});

/**
 * Never cache a write. `defaultCache` is read-oriented, but Next's server
 * actions POST to the same page URLs the navigation cache holds, and a
 * cached check-in is a lie about where someone was. Registered before
 * `addEventListeners` so it wins the route match.
 */
serwist.registerCapture(({ request }) => request.method !== 'GET', new NetworkOnly());

serwist.addEventListeners();

/**
 * Push (§8, §10.5).
 *
 * The drain sends `PushMessage` from packages/notifications — `{ title,
 * body, url? }` — so this parses that and degrades to plain text rather
 * than dropping a notification it cannot read. A push that renders nothing
 * is worse than a vague one: iOS counts undisplayed pushes against the
 * subscription and will eventually revoke it.
 */
self.addEventListener('push', (event) => {
  const raw = event.data;
  let title = 'The Hospitality Company';
  let body = '';
  let url = HOME;

  if (raw) {
    try {
      const data = raw.json() as { title?: string; body?: string; url?: string };
      title = data.title ?? title;
      body = data.body ?? '';
      url = data.url ?? HOME;
    } catch {
      body = raw.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Deep link (§10.4): a tapped N5 opens that invitation, not the app's
      // front door. `tag` collapses a repeat of the same one.
      data: { url },
      tag: url,
    }),
  );
});

/**
 * Tapping one opens the deep link — reusing an open window if there is one,
 * so a worker mid-check-in is not thrown onto a second copy of the app.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? HOME;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/**
 * The endpoint rotated (§10.5, "re-subscribe on token change").
 *
 * Browsers fire this when they retire a subscription. The SW cannot reach
 * the database — it has no Supabase session — so it re-subscribes with the
 * key the page handed it and asks any open window to persist the new
 * endpoint. With no window open it stores the subscription for the page to
 * pick up on next open; `lib/push.ts` reconciles on every launch, so a
 * rotation that happens while the app is closed is repaired the next time
 * it is opened rather than silently ending the worker's notifications.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as ExtendableEvent & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  };

  event.waitUntil(
    (async () => {
      const applicationServerKey = change.oldSubscription?.options?.applicationServerKey ?? null;
      let fresh = change.newSubscription ?? null;
      if (!fresh && applicationServerKey) {
        fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }
      if (!fresh) return;

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({
          type: 'push-subscription-changed',
          subscription: fresh.toJSON(),
          oldEndpoint: change.oldSubscription?.endpoint ?? null,
        });
      }
    })(),
  );
});

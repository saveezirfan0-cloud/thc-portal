/**
 * The Staff App's service worker — Scope §10.5, ADR-0001 (docs/06).
 *
 * Three jobs, in the order they matter to a worker standing outside a
 * venue on one bar of signal:
 *
 *   1. Receive Web Push with the app closed. This is the whole of §8 on a
 *      PWA: N1–N15 are device-level, and on iOS they only arrive at all
 *      once the app is installed to the home screen (16.4+). That is why
 *      /install exists and why it is not decoration.
 *   2. Serve the app shell offline, so opening the app on the Underground
 *      shows the shell and an honest "you are offline" rather than the
 *      browser's dinosaur.
 *   3. Keep the queued check-in attempts alive. The queue itself belongs
 *      to the on-shift screen (§5, S5); what lives here is the Background
 *      Sync registration that replays it on Android. iOS has no Background
 *      Sync, so the app also replays on next open — never only here.
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

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A worker must never be looking at a stale build of the check-in screen:
  // the times and the rules in it change. Take over as soon as we can.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
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

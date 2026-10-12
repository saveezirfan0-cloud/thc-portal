import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service worker's push half (§8, §10.5) — what it draws from the
 * payload the drain sends, and where a tap goes. N8 is the one push that
 * carries a button ("Re-upload", §2.3 / §2.6): it must appear where the
 * platform draws buttons and, like the tap, open /documents.
 *
 * Serwist itself is not under test and is stubbed; `self` is a minimal
 * ServiceWorkerGlobalScope with just the members sw.ts touches.
 */

const serwistOptions = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));

vi.mock('serwist', () => {
  // Strategies and plugins stand in by name: `defaultCache` below is the
  // REAL one, and if Vitest hands it this module its constructors must exist.
  class Strategy {
    cacheName: string | undefined;
    constructor(options?: { cacheName?: string }) {
      this.cacheName = options?.cacheName;
    }
  }
  class Plugin {}
  return {
    Serwist: class {
      constructor(options: Record<string, unknown>) {
        serwistOptions.current = options;
      }
      registerCapture() {}
      addEventListeners() {}
    },
    NetworkOnly: class NetworkOnly extends Strategy {},
    NetworkFirst: class NetworkFirst extends Strategy {},
    CacheFirst: class CacheFirst extends Strategy {},
    StaleWhileRevalidate: class StaleWhileRevalidate extends Strategy {},
    ExpirationPlugin: class ExpirationPlugin extends Plugin {},
    RangeRequestsPlugin: class RangeRequestsPlugin extends Plugin {},
  };
});
// Security round 12.10, item 2: the REAL defaultCache, as a production build
// gets it (in development it is a single NetworkOnly, which would prove
// nothing). It used to be stubbed as [] here, so nothing noticed that its
// NetworkFirst catch-alls kept a worker's personal responses.
vi.mock('@serwist/next/worker', async () => {
  const env = process.env as Record<string, string | undefined>;
  const was = env['NODE_ENV'];
  env['NODE_ENV'] = 'production';
  try {
    return await vi.importActual<Record<string, unknown>>('@serwist/next/worker');
  } finally {
    env['NODE_ENV'] = was;
  }
});

type Handler = (event: unknown) => void;

const sw = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn<
    (title: string, options?: Record<string, unknown>) => Promise<void>
  >(async () => undefined);
  const openWindow = vi.fn<(url: string) => Promise<null>>(async () => null);
  let windows: { focus: () => Promise<void>; navigate: (url: string) => Promise<void> }[] = [];
  // Tags of the notifications "still in the notification centre".
  let showing: string[] = [];
  const getNotifications = async ({ tag }: { tag?: string } = {}) =>
    showing.filter((t) => tag === undefined || t === tag).map((t) => ({ tag: t }));
  const setAppBadge = vi.fn<(n?: number) => Promise<void>>(async () => undefined);
  const store = new Map<string, string>();
  const cacheNames = new Set<string>();
  const caches = {
    keys: async () => [...cacheNames],
    delete: async (name: string) => cacheNames.delete(name),
    open: async () => ({
      match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
      put: async (key: string, response: Response) => {
        store.set(key, await response.text());
      },
    }),
  };
  const self = {
    __SW_MANIFEST: [],
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: { showNotification, getNotifications, pushManager: { subscribe: vi.fn() } },
    clients: {
      matchAll: async () => windows,
      openWindow,
    },
    navigator: { setAppBadge, clearAppBadge: vi.fn(async () => undefined) },
    caches,
  };
  return {
    handlers,
    showNotification,
    openWindow,
    setAppBadge,
    self,
    setWindows(next: typeof windows) {
      windows = next;
    },
    setShowing(next: string[]) {
      showing = next;
    },
    resetBadge() {
      store.clear();
    },
    cacheNames,
  };
});

Object.assign(globalThis, { self: sw.self });

await import('../../sw');

function push(data: unknown) {
  const waited: Promise<unknown>[] = [];
  sw.handlers.get('push')!({
    data: { json: () => data, text: () => String(data) },
    waitUntil: (p: Promise<unknown>) => waited.push(p),
  });
  return Promise.all(waited);
}

function click(url: string | undefined, action = '') {
  const waited: Promise<unknown>[] = [];
  sw.handlers.get('notificationclick')!({
    action,
    notification: { close: () => undefined, data: url === undefined ? undefined : { url } },
    waitUntil: (p: Promise<unknown>) => waited.push(p),
  });
  return Promise.all(waited);
}

beforeEach(() => {
  sw.showNotification.mockClear();
  sw.openWindow.mockClear();
  sw.setWindows([]);
  sw.setShowing([]);
  sw.setAppBadge.mockClear();
  sw.resetBadge();
});

describe('the red count on the app icon', () => {
  it('goes up by one with each push, like a native app', async () => {
    await push({ title: 'New invitation', body: 'x', url: '/invites/1' });
    await push({ title: 'New invitation', body: 'y', url: '/invites/2' });
    expect(sw.setAppBadge.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });

  it('does not count a push that only replaces one still on screen (same tag)', async () => {
    await push({ title: 'Document rejected', body: 'x', url: '/documents', tag: 'N8:doc-1' });
    sw.setShowing(['N8:doc-1']);
    await push({ title: 'Document rejected', body: 'y', url: '/documents', tag: 'N8:doc-1' });
    expect(sw.setAppBadge.mock.calls.map((c) => c[0])).toEqual([1]);
    expect(sw.showNotification).toHaveBeenCalledTimes(2);
  });

  it('still shows the notification when the badge cannot be painted', async () => {
    sw.setAppBadge.mockRejectedValueOnce(new Error('NotAllowedError'));
    await push({ title: 'Your shift today', body: 'Time to check in', url: '/shifts/41' });
    expect(sw.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe('push (§8)', () => {
  it('draws N8 with its Re-upload button, deep-linked to /documents', async () => {
    await push({
      title: 'Document rejected',
      body: 'Document rejected — Photo is blurred. Re-upload.',
      url: '/documents',
      action: 'Re-upload',
    });
    expect(sw.showNotification).toHaveBeenCalledWith(
      'Document rejected',
      expect.objectContaining({
        body: 'Document rejected — Photo is blurred. Re-upload.',
        data: { url: '/documents' },
        tag: '/documents',
        actions: [{ action: 'open', title: 'Re-upload' }],
      }),
    );
  });

  it('collapses by the payload tag when there is one (N8: per document), on /onboarding for a candidate', async () => {
    await push({
      title: 'Document rejected',
      body: 'Document rejected — Photo is blurred. Re-upload.',
      url: '/onboarding',
      action: 'Re-upload',
      tag: 'N8:doc-1',
    });
    expect(sw.showNotification).toHaveBeenCalledWith(
      'Document rejected',
      expect.objectContaining({
        data: { url: '/onboarding' },
        tag: 'N8:doc-1',
        actions: [{ action: 'open', title: 'Re-upload' }],
      }),
    );
  });

  it('draws no button on a push that names none', async () => {
    await push({ title: 'Your shift today', body: 'Time to check in', url: '/shifts/41' });
    const options = sw.showNotification.mock.calls[0]![1]!;
    expect(options).not.toHaveProperty('actions');
    expect(options['data']).toEqual({ url: '/shifts/41' });
  });

  it('falls back to /shifts when the payload has no deep link', async () => {
    await push({ title: 'Hello', body: 'x' });
    const options = sw.showNotification.mock.calls[0]![1]!;
    expect(options['data']).toEqual({ url: '/shifts' });
  });
});

describe('notificationclick (§10.4)', () => {
  it('opens the deep link, and the Re-upload button goes to the same place', async () => {
    await click('/documents');
    await click('/documents', 'open');
    expect(sw.openWindow.mock.calls.map((c) => c[0])).toEqual(['/documents', '/documents']);
  });

  it('reuses an open window rather than opening a second app', async () => {
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    sw.setWindows([{ focus, navigate }]);
    await click('/documents', 'open');
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/documents');
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it('lands on /shifts when a notification carries no link', async () => {
    await click(undefined);
    expect(sw.openWindow).toHaveBeenCalledWith('/shifts');
  });
});

// ---------------------------------------------------------------------
// Security round 12.10, item 2 — what the worker keeps
// ---------------------------------------------------------------------

const ORIGIN = 'https://staff.thehospitalitycompany.co.uk';

interface Entry {
  matcher: RegExp | ((options: Record<string, unknown>) => unknown);
  handler: { constructor: { name: string }; cacheName?: string };
  method?: string;
}

/**
 * The handler Serwist's router would pick for a GET: the first entry of
 * `runtimeCaching` whose matcher answers — a RegExp on the full URL (and,
 * cross-origin, only a match at index 0, as Serwist's RegExpRoute does),
 * a function with `{ url, request, sameOrigin }`.
 */
function handlerFor(href: string, init: { mode?: string; headers?: Record<string, string> } = {}) {
  const entries = (serwistOptions.current?.['runtimeCaching'] ?? []) as Entry[];
  const url = new URL(href, ORIGIN);
  const sameOrigin = url.origin === ORIGIN;
  const request = {
    method: 'GET',
    mode: init.mode ?? 'cors',
    headers: new Headers(init.headers ?? {}),
    destination: init.mode === 'navigate' ? 'document' : '',
    url: url.href,
  };
  for (const entry of entries) {
    if (entry.method && entry.method !== 'GET') continue;
    let hit: unknown;
    if (entry.matcher instanceof RegExp) {
      const found = entry.matcher.exec(url.href);
      hit = found && (sameOrigin || found.index === 0);
    } else {
      hit = entry.matcher({ url, request, sameOrigin, event: {} });
    }
    if (hit) return { kind: entry.handler.constructor.name, cacheName: entry.handler.cacheName };
  }
  return null;
}

describe('runtime caching never keeps a personal response', () => {
  it('is the real defaultCache behind our rules, not a stub', () => {
    const entries = (serwistOptions.current?.['runtimeCaching'] ?? []) as Entry[];
    const names = entries.map((e) => e.handler.cacheName).filter(Boolean);
    // The production list, with its NetworkFirst catch-alls in it.
    expect(names).toEqual(expect.arrayContaining(['others', 'cross-origin', 'pages-rsc']));
  });

  it.each([
    ['a navigation', '/shifts', { mode: 'navigate' }],
    ['an RSC payload', '/profile/payments?_rsc=1', { headers: { RSC: '1' } }],
    ['an RSC prefetch', '/invites', { headers: { RSC: '1', 'Next-Router-Prefetch': '1' } }],
    ['a shift’s calendar file', '/shifts/b1/calendar.ics', {}],
    ['the image optimiser (it proxies signed photos)', '/_next/image?url=%2Fx.png&w=64', {}],
    ['a same-origin API read', '/api/anything', {}],
    ['a same-origin JSON file', '/whatever.json', {}],
    ['a Supabase REST read', 'https://abc.supabase.co/rest/v1/staff?select=*', {}],
    ['a Supabase RPC', 'https://abc.supabase.co/rest/v1/rpc/staff_me', {}],
    [
      'a signed Storage URL for a photo',
      'https://abc.supabase.co/storage/v1/object/sign/photos/s1/selfie-1.jpg?token=t',
      {},
    ],
    [
      'a signed Storage URL ending in an image extension',
      'https://abc.supabase.co/storage/v1/object/sign/documents/s1/passport/a.png',
      {},
    ],
  ] as const)('%s goes to the network only', (_label, href, init) => {
    expect(handlerFor(href, init as never)).toEqual({ kind: 'NetworkOnly', cacheName: undefined });
  });

  it.each([
    ['the build’s hashed script', '/_next/static/chunks/app-1a2b.js', 'next-static-js-assets'],
    ['the build’s stylesheet', '/_next/static/css/9f8e.css', 'static-style-assets'],
    ['a self-hosted font', '/_next/static/media/jakarta.woff2', 'static-font-assets'],
    ['an app icon', '/icon-192.png', 'static-image-assets'],
    ['an induction slide', '/induction/slide-01.webp', 'static-image-assets'],
  ])('%s is still cached (the offline shell needs it)', (_label, href, cacheName) => {
    const handler = handlerFor(href);
    expect(handler?.kind).not.toBe('NetworkOnly');
    expect(handler?.cacheName).toBe(cacheName);
  });

  it('keeps the /offline fallback for documents', () => {
    const fallbacks = serwistOptions.current?.['fallbacks'] as {
      entries: { url: string; matcher: (o: { request: { destination: string } }) => boolean }[];
    };
    const offline = fallbacks.entries.find((e) => e.url === '/offline')!;
    expect(offline.matcher({ request: { destination: 'document' } })).toBe(true);
  });
});

describe('activate clears what an earlier worker cached', () => {
  it('deletes the runtime caches that could hold personal data, and keeps the rest', async () => {
    for (const name of [
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
      'serwist-precache-v2-https://staff.example/',
      'static-image-assets',
      'next-static-js-assets',
      'thc-app-badge',
    ]) {
      sw.cacheNames.add(name);
    }
    const waited: Promise<unknown>[] = [];
    sw.handlers.get('activate')!({ waitUntil: (p: Promise<unknown>) => waited.push(p) });
    await Promise.all(waited);
    expect([...sw.cacheNames].sort()).toEqual(
      [
        'next-static-js-assets',
        'serwist-precache-v2-https://staff.example/',
        'static-image-assets',
        'thc-app-badge',
      ].sort(),
    );
  });
});

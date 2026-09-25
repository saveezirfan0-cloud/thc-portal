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

vi.mock('serwist', () => ({
  Serwist: class {
    registerCapture() {}
    addEventListeners() {}
  },
  NetworkOnly: class {},
}));
vi.mock('@serwist/next/worker', () => ({ defaultCache: [] }));

type Handler = (event: unknown) => void;

const sw = vi.hoisted(() => {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn<
    (title: string, options?: Record<string, unknown>) => Promise<void>
  >(async () => undefined);
  const openWindow = vi.fn<(url: string) => Promise<null>>(async () => null);
  let windows: { focus: () => Promise<void>; navigate: (url: string) => Promise<void> }[] = [];
  const self = {
    __SW_MANIFEST: [],
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: { showNotification, pushManager: { subscribe: vi.fn() } },
    clients: {
      matchAll: async () => windows,
      openWindow,
    },
  };
  return {
    handlers,
    showNotification,
    openWindow,
    self,
    setWindows(next: typeof windows) {
      windows = next;
    },
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

import { describe, expect, it, vi } from 'vitest';
import {
  RELOAD_GUARD_MS,
  isStaleChunk,
  isStaleDeploy,
  reloadForNewBuild,
  reloadForStaleChunk,
  watchForStaleChunks,
} from '../stale-deploy';

/** Go-live audit B5: a phone on an older build than the server. */
describe('isStaleDeploy', () => {
  it('is Next’s "Server Action was not found", by its name', () => {
    const e = Object.assign(new Error('Server Action "abc" was not found'), {
      name: 'UnrecognizedActionError',
    });
    expect(isStaleDeploy(e)).toBe(true);
  });

  it('is not a network failure, or anything else', () => {
    expect(isStaleDeploy(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleDeploy('UnrecognizedActionError')).toBe(false);
    expect(isStaleDeploy(null)).toBe(false);
  });
});

describe('reloadForNewBuild', () => {
  function fakeWindow() {
    const store = new Map<string, string>();
    return {
      location: { reload: vi.fn() } as unknown as Location,
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      } as unknown as Storage,
    };
  }

  it('reloads once, and not again within the guard, so a broken deploy cannot loop', () => {
    const win = fakeWindow();
    expect(reloadForNewBuild(win, 1_000_000)).toBe(true);
    expect(reloadForNewBuild(win, 1_000_000 + RELOAD_GUARD_MS - 1)).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(reloadForNewBuild(win, 1_000_000 + RELOAD_GUARD_MS)).toBe(true);
    expect(win.location.reload).toHaveBeenCalledTimes(2);
  });

  it('storage that throws still reloads', () => {
    const win = {
      location: { reload: vi.fn() } as unknown as Location,
      sessionStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {},
      } as unknown as Storage,
    };
    expect(reloadForNewBuild(win, 5)).toBe(true);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('on the server there is nothing to reload', () => {
    expect(reloadForNewBuild(undefined)).toBe(false);
  });
});

/**
 * Go-live audit M4: the new service worker takes over open tabs and drops
 * the old build's precache, so a tab older than the deploy can ask for a
 * chunk that is gone. It reloads onto the new build, once.
 */
describe('isStaleChunk', () => {
  it.each([
    ['webpack’s ChunkLoadError', Object.assign(new Error('x'), { name: 'ChunkLoadError' })],
    [
      'webpack’s message, minified name',
      new Error(
        'Loading chunk 8269 failed.\n(error: https://staff.example/_next/static/chunks/8269-a.js)',
      ),
    ],
    [
      'a CSS chunk',
      new Error('Loading CSS chunk app/shifts/page failed.\n(/_next/static/css/a.css)'),
    ],
    ['a CSS chunk, by code', Object.assign(new Error('x'), { code: 'CSS_CHUNK_LOAD_FAILED' })],
    [
      'Chrome’s import()',
      new TypeError('Failed to fetch dynamically imported module: https://x/a.js'),
    ],
    ['Safari’s import()', new TypeError('Importing a module script failed.')],
    ['Firefox’s import()', new TypeError('error loading dynamically imported module')],
    ['an ErrorEvent’s message', 'Uncaught ChunkLoadError: Loading chunk 12 failed.'],
  ])('is %s', (_label, error) => {
    expect(isStaleChunk(error)).toBe(true);
  });

  it.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['a stale server action', Object.assign(new Error('x'), { name: 'UnrecognizedActionError' })],
    ['a render bug', new TypeError("Cannot read properties of undefined (reading 'map')")],
    ['nothing', null],
    ['a number', 404],
  ])('is not %s', (_label, error) => {
    expect(isStaleChunk(error)).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  function fakeWindow(onLine = true) {
    const store = new Map<string, string>();
    return {
      location: { reload: vi.fn() } as unknown as Location,
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      } as unknown as Storage,
      navigator: { onLine },
    };
  }
  const chunk = Object.assign(new Error('Loading chunk 1 failed.'), { name: 'ChunkLoadError' });

  it('reloads once a minute at most, sharing the stale-action guard', () => {
    const win = fakeWindow();
    expect(reloadForStaleChunk(chunk, win, 1_000_000)).toBe(true);
    expect(reloadForStaleChunk(chunk, win, 1_000_000 + 1_000)).toBe(false);
    // A stale server action right after cannot reload in turn.
    expect(reloadForNewBuild(win, 1_000_000 + 2_000)).toBe(false);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for any other error', () => {
    const win = fakeWindow();
    expect(reloadForStaleChunk(new Error('boom'), win, 1)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });

  it('does not reload while offline: the chunk is missing for want of a network', () => {
    const win = fakeWindow(false);
    expect(reloadForStaleChunk(chunk, win, 1)).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});

describe('watchForStaleChunks', () => {
  function target() {
    const events = new EventTarget();
    const store = new Map<string, string>();
    return Object.assign(events, {
      location: { reload: vi.fn() } as unknown as Location,
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      } as unknown as Storage,
      navigator: { onLine: true },
    });
  }

  it('reloads on an unhandled rejection of a missing chunk, and stops when cleaned up', () => {
    const win = target();
    const stop = watchForStaleChunks(win as never);
    win.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: Object.assign(new Error('Loading chunk 7 failed.'), { name: 'ChunkLoadError' }),
      }),
    );
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    stop();
    win.sessionStorage.setItem('thc:stale-deploy-reload', '0');
    win.dispatchEvent(
      Object.assign(new Event('error'), { error: new Error('Loading chunk 8 failed.') }),
    );
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on an uncaught error event, and ignores an ordinary one', () => {
    const win = target();
    const stop = watchForStaleChunks(win as never);
    win.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }));
    expect(win.location.reload).not.toHaveBeenCalled();
    win.dispatchEvent(
      Object.assign(new Event('error'), { error: null, message: 'Loading chunk 9 failed.' }),
    );
    expect(win.location.reload).toHaveBeenCalledTimes(1);
    stop();
  });
});

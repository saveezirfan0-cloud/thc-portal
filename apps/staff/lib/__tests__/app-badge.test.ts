import { describe, expect, it, vi } from 'vitest';
import { BADGE_CACHE, bumpAppBadge, clearAppBadge } from '../app-badge';

/**
 * The red count on the home-screen icon (§8, §10.5): one per push since the
 * app was last open, cleared by opening it, and never a reason for a push
 * to fail where the platform has no Badging API.
 */

function fakeCaches() {
  const stores = new Map<string, Map<string, string>>();
  const caches = {
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, string>();
      stores.set(name, store);
      return {
        match: async (key: string) => (store.has(key) ? new Response(store.get(key)) : undefined),
        put: async (key: string, response: Response) => {
          store.set(key, await response.text());
        },
      };
    },
  } as unknown as CacheStorage;
  return { caches, stores };
}

function fakeNavigator() {
  return {
    setAppBadge: vi.fn<(n?: number) => Promise<void>>(async () => undefined),
    clearAppBadge: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

describe('the app icon badge', () => {
  it('counts one per push: 1, 2, 3', async () => {
    const { caches } = fakeCaches();
    const nav = fakeNavigator();
    await bumpAppBadge(nav, caches);
    await bumpAppBadge(nav, caches);
    expect(await bumpAppBadge(nav, caches)).toBe(3);
    expect(nav.setAppBadge.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it('does not lose a push when two land in the same wake-up', async () => {
    const { caches } = fakeCaches();
    const nav = fakeNavigator();
    await Promise.all([bumpAppBadge(nav, caches), bumpAppBadge(nav, caches)]);
    expect(nav.setAppBadge).toHaveBeenLastCalledWith(2);
  });

  it('opening the app clears it, and the next push starts again at 1', async () => {
    const { caches } = fakeCaches();
    const nav = fakeNavigator();
    await bumpAppBadge(nav, caches);
    await bumpAppBadge(nav, caches);
    await clearAppBadge(nav, caches);
    expect(nav.clearAppBadge).toHaveBeenCalled();
    expect(await bumpAppBadge(nav, caches)).toBe(1);
  });

  it('keeps its count in its own cache, not one Serwist or a page uses', async () => {
    const { caches, stores } = fakeCaches();
    await bumpAppBadge(fakeNavigator(), caches);
    expect([...stores.keys()]).toEqual([BADGE_CACHE]);
  });

  it('does nothing — and throws nothing — where there is no Badging API', async () => {
    const { caches } = fakeCaches();
    await expect(bumpAppBadge({}, caches)).resolves.toBe(1);
    await expect(clearAppBadge({}, caches)).resolves.toBeUndefined();
    await expect(clearAppBadge({}, undefined)).resolves.toBeUndefined();
  });

  it('never throws when painting fails (badging not permitted)', async () => {
    const { caches } = fakeCaches();
    const nav = {
      setAppBadge: async () => {
        throw new Error('NotAllowedError');
      },
      clearAppBadge: async () => {
        throw new Error('NotAllowedError');
      },
    };
    await expect(bumpAppBadge(nav, caches)).resolves.toBe(0);
    await expect(clearAppBadge(nav, caches)).resolves.toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { RELOAD_GUARD_MS, isStaleDeploy, reloadForNewBuild } from '../stale-deploy';

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

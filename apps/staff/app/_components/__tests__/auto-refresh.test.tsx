// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Go-live audit H3: the list screens' background refresh — rarer, out of
 * step between phones, silent while hidden or offline, and never a second
 * render of a page that was just opened (a push tap).
 */
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const {
  AutoRefresh,
  ONLINE_SPREAD_MS,
  REFRESH_EVERY_MS,
  REFRESH_JITTER_MS,
  RETURN_PAUSE_MS,
  STALE_AFTER_MS,
  nextDelay,
} = await import('../AutoRefresh');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState;
let online: boolean;

const MAX_WAIT = REFRESH_EVERY_MS + REFRESH_JITTER_MS;

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
async function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  router.refresh.mockClear();
  visibility = 'visible';
  online = true;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<AutoRefresh />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('nextDelay', () => {
  it('is ~150 s, ±20 s', () => {
    expect(nextDelay(REFRESH_EVERY_MS, REFRESH_JITTER_MS, () => 0)).toBe(130_000);
    expect(nextDelay(REFRESH_EVERY_MS, REFRESH_JITTER_MS, () => 0.5)).toBe(150_000);
    expect(nextDelay(REFRESH_EVERY_MS, REFRESH_JITTER_MS, () => 1)).toBe(170_000);
    expect(REFRESH_EVERY_MS).toBe(150_000);
    expect(REFRESH_JITTER_MS).toBe(20_000);
  });
});

describe('AutoRefresh', () => {
  it('does not refresh at the old 60 s, and does within ~170 s', async () => {
    await advance(60_000);
    expect(router.refresh).not.toHaveBeenCalled();
    await advance(MAX_WAIT - 60_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('skips the tick while the page is hidden', async () => {
    visibility = 'hidden';
    await advance(MAX_WAIT * 2);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('skips the tick while the phone is offline', async () => {
    online = false;
    await advance(MAX_WAIT * 2);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a page just opened (a push tap) is not refreshed again on coming into view', async () => {
    await setVisibility('hidden');
    await setVisibility('visible');
    await advance(RETURN_PAUSE_MS);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('back in view after a while: one refresh, after the short pause', async () => {
    await setVisibility('hidden');
    await advance(STALE_AFTER_MS);
    await setVisibility('visible');
    expect(router.refresh).not.toHaveBeenCalled();
    await advance(RETURN_PAUSE_MS);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('hidden again before the pause ends: nothing', async () => {
    await advance(STALE_AFTER_MS);
    await setVisibility('hidden');
    await setVisibility('visible');
    await setVisibility('hidden');
    await advance(RETURN_PAUSE_MS);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('back online: one refresh within the spread', async () => {
    await advance(STALE_AFTER_MS);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await advance(RETURN_PAUSE_MS + ONLINE_SPREAD_MS);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('stops when the page goes away', async () => {
    act(() => root.unmount());
    root = createRoot(container);
    await advance(MAX_WAIT * 2);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

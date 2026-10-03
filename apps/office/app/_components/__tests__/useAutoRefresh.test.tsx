// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { useAutoRefresh } from '../useAutoRefresh';

function Probe() {
  useAutoRefresh(30_000);
  return null;
}

let root: Root;
let visibility: DocumentVisibilityState = 'visible';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
});

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  visibility = 'visible';
  root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useAutoRefresh', () => {
  it('re-reads the page every interval while the tab is visible', () => {
    vi.advanceTimersByTime(29_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing while the tab is hidden, and catches up when it returns', () => {
    visibility = 'hidden';
    vi.advanceTimersByTime(90_000);
    expect(refresh).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not double-refresh when the tab flickers right after a refresh', () => {
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops on unmount', () => {
    act(() => root.unmount());
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
    root = createRoot(document.createElement('div'));
  });
});

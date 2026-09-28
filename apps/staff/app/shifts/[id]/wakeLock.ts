'use client';

import { useEffect, useState } from 'react';

/**
 * ADR-0001 / docs/06 Option A: a PWA cannot track location with the screen
 * off, so while a worker is checked in the shift screen asks the browser to
 * keep the screen on (the Screen Wake Lock API). Location pings then keep
 * arriving for as long as the page is open, which is what off-site check-out
 * reads (§5.1) instead of falling back to the check-in fix.
 *
 * `on` — the lock is held. `off` — asked for and not held (the tab is
 * hidden, battery saver refused it, or it was released). `unsupported` —
 * this browser has no wake lock (iOS before 16.4, older Firefox); the
 * "keep this screen open" bar is still shown, so the worker is told either way.
 */
export type WakeState = 'on' | 'off' | 'unsupported';

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

function wakeLockApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock ?? null;
}

export function useWakeLock(active: boolean): WakeState {
  // Starts `off` on the server and the client alike, so the first render
  // hydrates; the effect finds out what this browser can do.
  const [state, setState] = useState<WakeState>('off');

  useEffect(() => {
    const api = wakeLockApi();
    if (!api) {
      setState('unsupported');
      return;
    }
    if (!active) return;
    let sentinel: Sentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      // The browser only grants the lock to a visible page, and drops it
      // whenever the page is hidden — so it is asked for again on return.
      if (stopped || sentinel || document.visibilityState !== 'visible') return;
      try {
        const next = await api.request('screen');
        if (stopped) {
          void next.release();
          return;
        }
        sentinel = next;
        setState('on');
        next.addEventListener('release', () => {
          sentinel = null;
          if (!stopped) setState('off');
        });
      } catch {
        // Refused (battery saver, permissions policy). Nothing to undo.
        setState('off');
      }
    };

    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    void acquire();

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel) void sentinel.release();
      sentinel = null;
      setState('off');
    };
  }, [active]);

  return state;
}

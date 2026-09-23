'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "↓ Pull to refresh" (§10.4).
 *
 * A worker waiting on the office's verification pulls down to see whether
 * it has happened. Dragging down from the top of the page by more than the
 * threshold re-runs the page's server read (`router.refresh()`); the line
 * is also a button, because a pull gesture is invisible to a keyboard and
 * to a desktop browser.
 */
const THRESHOLD_PX = 70;

export function PullToRefresh({ updatedAt }: { updatedAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    function onStart(event: TouchEvent) {
      startY.current = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null;
    }
    function onMove(event: TouchEvent) {
      if (startY.current === null) return;
      const dy = (event.touches[0]?.clientY ?? 0) - startY.current;
      setArmed(dy > THRESHOLD_PX);
    }
    function onEnd() {
      if (startY.current !== null && armed) start(() => router.refresh());
      startY.current = null;
      setArmed(false);
    }
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [armed, router]);

  return (
    <button type="button" className="ptr" onClick={() => start(() => router.refresh())}>
      {pending
        ? 'Refreshing…'
        : armed
          ? '↑ Release to refresh'
          : `↓ Pull to refresh · updated ${updatedAt}`}
    </button>
  );
}

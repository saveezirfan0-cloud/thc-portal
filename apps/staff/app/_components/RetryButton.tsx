'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@thc/ui';

/**
 * "Try again" for a screen whose read failed (audit D18).
 *
 * It re-runs the page's server read with `router.refresh()`, and the same
 * happens on a pull-down from the top of the page, which is the gesture a
 * worker reaches for first on a phone. `onRetry` lets an error boundary
 * reset itself as well (Next's `reset()`), so a thrown render gets a second
 * chance instead of the cached failure.
 */
const PULL_THRESHOLD_PX = 70;

export function RetryButton({
  label = 'Try again',
  onRetry,
}: {
  label?: string;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const startY = useRef<number | null>(null);
  const pulled = useRef(false);

  const retry = () =>
    start(() => {
      onRetry?.();
      router.refresh();
    });
  // The listeners below are registered once; they call the latest `retry`.
  const latest = useRef(retry);
  latest.current = retry;

  useEffect(() => {
    function onStart(event: TouchEvent) {
      startY.current = window.scrollY <= 0 ? (event.touches[0]?.clientY ?? null) : null;
      pulled.current = false;
    }
    function onMove(event: TouchEvent) {
      if (startY.current === null) return;
      pulled.current = (event.touches[0]?.clientY ?? 0) - startY.current > PULL_THRESHOLD_PX;
    }
    function onEnd() {
      if (startY.current !== null && pulled.current) latest.current();
      startY.current = null;
      pulled.current = false;
    }
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  return (
    <Button block tone="primary" disabled={pending} onClick={retry}>
      {pending ? 'Trying again…' : label}
    </Button>
  );
}

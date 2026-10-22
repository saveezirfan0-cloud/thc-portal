'use client';

import { useEffect, useState } from 'react';

/**
 * The reader's clock, for the few things on the monitor that depend on it
 * (whether Remind is offered, ADR-0188). Null until mounted, so the server
 * render and the first client render agree and nothing flashes in; then it
 * ticks every 30 seconds, the board's own refresh.
 */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

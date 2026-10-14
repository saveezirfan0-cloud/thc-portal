'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The "Saved" receipt beside a field that saves on change (ADR-0137 §1,
 * release audit m3): gender and languages wrote to the database the moment
 * they changed and said nothing, so a manager could not tell an autosaved
 * field from one waiting for a Save that does not exist. `flash()` shows
 * the receipt for a few seconds.
 */
export function useSavedFlash(ms = 3000): [boolean, () => void] {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setShown(true);
    timer.current = setTimeout(() => setShown(false), ms);
  }, [ms]);
  return [shown, flash];
}

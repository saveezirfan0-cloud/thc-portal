'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * `useState` that outlives the component (ADR-0204). Next remounts a page's
 * shell on every route change, so a Ticket draft — and above all a screen
 * recording in progress — would be lost the moment the reporter clicked
 * through to the page they are showing. State here lives in the module, keyed
 * by name, and every mounted reader is told when it changes. A setter keeps
 * working after its component is gone, which is what lets a recording that
 * ends on another page still hand its file to the dialog.
 *
 * `initial` must be a stable value (a module constant): it is the server
 * snapshot and what an unset key reads as.
 */
const values = new Map<string, unknown>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSharedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const read = (): T => (values.has(key) ? (values.get(key) as T) : initial);
  const value = useSyncExternalStore(subscribe, read, () => initial);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = values.has(key) ? (values.get(key) as T) : initial;
      const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
      values.set(key, resolved);
      listeners.forEach((listener) => listener());
    },
    [key, initial],
  );
  return [value, set];
}

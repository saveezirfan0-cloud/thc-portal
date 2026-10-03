'use client';

import { useAutoRefresh } from './useAutoRefresh';

/**
 * Drop into a server page (`<AutoRefresh />`) to keep it current — for the
 * screens whose data changes without the manager doing anything. Renders
 * nothing.
 */
export function AutoRefresh({ everyMs }: { everyMs?: number }) {
  useAutoRefresh(everyMs);
  return null;
}

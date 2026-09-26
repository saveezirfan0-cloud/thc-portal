/**
 * /inbox filters — the URL is the state (ADR-0058). No imports, so the
 * client-side filter bar can use it without pulling the register into the
 * browser bundle.
 */

export type InboxStatus = 'queued' | 'sent' | 'failed';

export const STATUSES: readonly { value: InboxStatus; label: string }[] = [
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
];

export type Period = '24h' | '7d' | '30d' | '90d' | 'all';

export const PERIODS: readonly { value: Period; label: string }[] = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
];

export const DEFAULT_PERIOD: Period = '30d';

export function parsePeriod(value: unknown): Period {
  return PERIODS.some((p) => p.value === value) ? (value as Period) : DEFAULT_PERIOD;
}

export function parseStatus(value: unknown): InboxStatus | null {
  return STATUSES.some((s) => s.value === value) ? (value as InboxStatus) : null;
}

/** The earliest queue time a period covers, or null for all time. */
export function periodStart(period: Period, now: Date): string | null {
  const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, all: 0 }[period];
  return days ? new Date(now.getTime() - days * 86_400_000).toISOString() : null;
}

export interface InboxQuery {
  type: string | null;
  status: InboxStatus | null;
  period: Period;
  before: number | null;
}

/**
 * The /inbox URL for the current filters with some changed. Changing a
 * filter goes back to the newest page; the default period is left out, so
 * the plain URL is the default view.
 */
export function inboxHref(
  current: InboxQuery,
  patch: Partial<Record<'type' | 'status' | 'period' | 'before', string | null>>,
): string {
  const merged: Record<string, string | null> = {
    type: current.type,
    status: current.status,
    period: current.period === DEFAULT_PERIOD ? null : current.period,
    before: null,
    ...patch,
  };
  if (merged['period'] === DEFAULT_PERIOD) merged['period'] = null;
  const search = new URLSearchParams();
  for (const key of ['type', 'status', 'period', 'before']) {
    const value = merged[key];
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/inbox?${query}` : '/inbox';
}

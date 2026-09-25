'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@thc/ui';
import { type InboxQuery, PERIODS, STATUSES, inboxHref } from './filters';

/**
 * Type, status and period for /inbox. Each change is a navigation, so the
 * filtered view is a URL a manager can bookmark or send on.
 */
export function InboxFilterBar({
  query,
  types,
}: {
  query: InboxQuery;
  types: readonly { code: string; label: string }[];
}) {
  const router = useRouter();
  const go = (patch: Parameters<typeof inboxHref>[1]) => router.push(inboxHref(query, patch));

  return (
    <div className="toolbar inbox-filters">
      <Select
        aria-label="Type"
        value={query.type ?? ''}
        onChange={(event) => go({ type: event.target.value || null })}
      >
        <option value="">Every type</option>
        {types.map((type) => (
          <option key={type.code} value={type.code}>
            {type.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Status"
        value={query.status ?? ''}
        onChange={(event) => go({ status: event.target.value || null })}
      >
        <option value="">Every status</option>
        {STATUSES.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Period"
        value={query.period}
        onChange={(event) => go({ period: event.target.value })}
      >
        {PERIODS.map((period) => (
          <option key={period.value} value={period.value}>
            {period.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

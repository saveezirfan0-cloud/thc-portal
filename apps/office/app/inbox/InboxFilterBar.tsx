'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchInput, Select, Tabs } from '@thc/ui';
import { AUDIENCES, type Audience, type InboxQuery, PERIODS, STATUSES, inboxHref } from './filters';

/**
 * Whose emails, a search, type, status and period for /inbox. Each change is
 * a navigation, so the filtered view is a URL a manager can bookmark or send
 * on. The search matches an address, a name or an Employee ID, so "did we
 * email this person?" is one box (ADR-0086).
 */
export function InboxFilterBar({
  query,
  types,
}: {
  query: InboxQuery;
  types: readonly { code: string; label: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState(query.q ?? '');
  const go = (patch: Parameters<typeof inboxHref>[1]) => router.push(inboxHref(query, patch));

  return (
    <>
      <Tabs<Audience>
        aria-label="Whose emails"
        value={query.audience}
        onChange={(who) => go({ who })}
        options={AUDIENCES.map((a) => ({ value: a.value, label: a.label }))}
      />
      <div className="toolbar inbox-filters">
        <form
          className="search inbox-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: text.trim() || null });
          }}
        >
          <SearchInput
            aria-label="Search the sent emails"
            placeholder="Search an email address, name or Employee ID — press Enter"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </form>
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
    </>
  );
}

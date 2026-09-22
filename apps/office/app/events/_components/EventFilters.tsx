'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EVENT_STATUS_LABEL, type EventStatus } from '@thc/domain';
import { hrefFor, type ToolbarQuery } from './EventToolbar';
import type { ClientOption } from '../data';

const STATUSES: EventStatus[] = ['upcoming', 'ongoing', 'completed', 'cancelled'];

/**
 * Search and the two filters (§3.1).
 *
 * They write to the URL rather than to component state, so a filtered view is
 * a link: the back button works, and a manager can send "this client, this
 * month" to a colleague. The search box submits as a form so it does not
 * navigate on every keystroke.
 */
export function EventFilters({ query, clients }: { query: ToolbarQuery; clients: ClientOption[] }) {
  const router = useRouter();
  const [q, setQ] = useState(query.q);

  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(hrefFor({ ...query, q }));
      }}
    >
      <div className="search">
        <input
          className="input"
          style={{ height: 32, width: 220 }}
          placeholder="Search event, client, PO"
          aria-label="Search events"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      <select
        className="input"
        style={{ height: 32, width: 170 }}
        aria-label="Filter by client"
        value={query.clientId}
        onChange={(event) => router.push(hrefFor({ ...query, clientId: event.target.value }))}
      >
        <option value="">All clients</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>

      <select
        className="input"
        style={{ height: 32, width: 140 }}
        aria-label="Filter by status"
        value={query.status}
        onChange={(event) => router.push(hrefFor({ ...query, status: event.target.value }))}
      >
        <option value="">Any status</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {EVENT_STATUS_LABEL[status]}
          </option>
        ))}
      </select>

      <button type="submit" className="sb-sr-only">
        Search
      </button>
    </form>
  );
}

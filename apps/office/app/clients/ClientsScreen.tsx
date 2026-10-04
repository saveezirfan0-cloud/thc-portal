'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Chip, EmptyState, Note, Panel, Select } from '@thc/ui';
import { AddedFilters } from '../_components/AddedFilters';
import { OfficeShell } from '../_components/OfficeShell';
import {
  NO_ADDED_FILTER,
  addedFilterActive,
  formatDateAdded,
  matchesAdded,
  type AddedFilter,
} from '../_lib/addedBy';
import { ClientModal } from './ClientModal';
import type { Client } from './types';
import './clients.css';

export interface ClientsScreenProps {
  clients: Client[];
  problem: string | null;
  /** ADR-0061: false for an office role without finance — no margin anywhere. */
  ratesVisible?: boolean;
}

type Sort = 'name' | 'events' | 'margin' | 'newest' | 'oldest';
type PolicyFilter = 'all' | 'paid' | 'unpaid';
type BufferFilter = 'all' | 'paid' | 'strict';

/** The Rate-card-role filter's value for clients with an empty rate card. */
const NO_RATE_CARD = '\u0000none';

const PAGE_SIZE = 8;

/**
 * /clients — the client directory (§9.7).
 *
 * Search, sort and pagination run over rows already on the page: the whole
 * directory is one query, and at THC's scale (tens of clients, not
 * thousands) paging the database would cost a round trip per keystroke to
 * save nothing.
 *
 * There is no Delete anywhere on this screen, deliberately — §9.7 is
 * explicit that a client record can be edited at any time but never
 * removed from the system.
 */
export function ClientsScreen({ clients, problem, ratesVisible = true }: ClientsScreenProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [page, setPage] = useState(0);
  const [breaks, setBreaks] = useState<PolicyFilter>('all');
  const [buffer, setBuffer] = useState<BufferFilter>('all');
  const [role, setRole] = useState('');
  const [added, setAdded] = useState<AddedFilter>(NO_ADDED_FILTER);
  /** `null` = closed, `'new'` = create, a client = edit it. */
  const [editing, setEditing] = useState<Client | 'new' | null>(null);

  const roles = useMemo(
    () => [...new Set(clients.flatMap((client) => client.rate_card_roles))].sort(),
    [clients],
  );
  const hasEmptyRateCard = clients.some((client) => client.rate_card_roles.length === 0);

  const filtersActive =
    breaks !== 'all' || buffer !== 'all' || role !== '' || addedFilterActive(added);

  // Every filter change goes back to the first page: the pager would
  // otherwise be left past the end of a shorter list.
  const clearFilters = () => {
    setBreaks('all');
    setBuffer('all');
    setRole('');
    setAdded(NO_ADDED_FILTER);
    setPage(0);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = clients.filter((client) => {
      if (
        needle &&
        !client.name.toLowerCase().includes(needle) &&
        !client.contact_name.toLowerCase().includes(needle) &&
        !client.contact_emails.some((email) => email.toLowerCase().includes(needle))
      ) {
        return false;
      }
      if (breaks !== 'all' && client.pays_breaks !== (breaks === 'paid')) return false;
      // The buffer policy's two words are "paid" and "strict" (§3.2, RULE-15).
      if (buffer !== 'all' && client.pays_buffer !== (buffer === 'paid')) return false;
      if (role === NO_RATE_CARD) {
        if (client.rate_card_roles.length > 0) return false;
      } else if (role && !client.rate_card_roles.includes(role)) {
        return false;
      }
      return matchesAdded(client, added);
    });

    const sorted = [...matched];
    if (sort === 'events') sorted.sort((a, b) => b.event_count - a.event_count);
    else if (sort === 'newest') sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === 'oldest') sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    // Clients with nothing delivered have no margin; they sort last rather
    // than reading as 0% (§9.7).
    else if (sort === 'margin') {
      sorted.sort((a, b) => (b.avg_margin_pct ?? -1) - (a.avg_margin_pct ?? -1));
    } else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [clients, query, breaks, buffer, role, added, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const close = () => setEditing(null);
  const saved = () => {
    close();
    router.refresh();
  };

  return (
    <OfficeShell
      activeHref="/clients"
      title="Clients"
      crumbs={
        <>
          <b>
            {clients.length} {clients.length === 1 ? 'client' : 'clients'}
          </b>{' '}
          · rate cards and dress codes live on each client&rsquo;s card
        </>
      }
      actions={
        <Button tone="primary" size="sm" onClick={() => setEditing('new')}>
          + New client
        </Button>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            style={{ height: 32, width: 280 }}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search client, contact, email"
            aria-label="Search client, contact, email"
          />
        </div>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          aria-label="Sort clients"
          style={{ height: 32, width: 190 }}
        >
          <option value="name">Sort: name A–Z</option>
          <option value="events">Sort: most events</option>
          <option value="newest">Sort: newest added</option>
          <option value="oldest">Sort: oldest added</option>
          {ratesVisible ? <option value="margin">Sort: margin</option> : null}
        </Select>
        {ratesVisible ? (
          <div className="right">
            <span className="muted sm">
              Average margin = (charge − final pay) ÷ charge across completed events, after holiday
              pay
            </span>
          </div>
        ) : null}
      </div>

      <div className="toolbar" role="group" aria-label="Client filters">
        <Select
          value={breaks}
          onChange={(event) => {
            setBreaks(event.target.value as PolicyFilter);
            setPage(0);
          }}
          aria-label="Filter by break policy"
          style={{ height: 32, width: 160 }}
        >
          <option value="all">Breaks: all</option>
          <option value="paid">Breaks: paid</option>
          <option value="unpaid">Breaks: unpaid</option>
        </Select>
        <Select
          value={buffer}
          onChange={(event) => {
            setBuffer(event.target.value as BufferFilter);
            setPage(0);
          }}
          aria-label="Filter by buffer policy"
          style={{ height: 32, width: 160 }}
        >
          <option value="all">Buffer: all</option>
          <option value="paid">Buffer: paid</option>
          <option value="strict">Buffer: strict</option>
        </Select>
        <Select
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(0);
          }}
          aria-label="Filter by rate card role"
          style={{ height: 32, width: 190 }}
        >
          <option value="">Rate card role: any</option>
          {roles.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {hasEmptyRateCard ? <option value={NO_RATE_CARD}>No rate card yet</option> : null}
        </Select>
        <AddedFilters
          rows={clients}
          value={added}
          onChange={(next) => {
            setAdded(next);
            setPage(0);
          }}
        />
        {filtersActive ? (
          <div className="right">
            <Button size="sm" tone="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>

      <Panel flush>
        <div className="panel-b tight">
          {shown.length === 0 ? (
            <EmptyState>
              <h3>
                {clients.length === 0
                  ? 'No clients yet'
                  : filtersActive
                    ? 'No client matches those filters'
                    : 'No client matches that search'}
              </h3>
              <p>
                {clients.length === 0
                  ? 'A client has to exist before an event can be built for it.'
                  : filtersActive
                    ? 'Loosen a filter, or clear them to see every client.'
                    : 'Search runs over the client name, the contact and the contact emails.'}
              </p>
            </EmptyState>
          ) : (
            <table className="tbl card-rows">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Rate card roles</th>
                  <th>Policies</th>
                  <th className="num">Events</th>
                  {ratesVisible ? <th className="num">Avg margin</th> : null}
                  <th>Date added</th>
                  <th>Added by</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((client) => (
                  <tr key={client.id}>
                    <td className="name cell-title">
                      {/*
                        The name opens the card (§9.7), not the edit modal:
                        the card is where the rate card, the qualified pool
                        and this client's events live, and Edit is one
                        button on it.
                      */}
                      <Link href={`/clients/${client.id}`} className="client-name">
                        {client.name}
                      </Link>
                      <span className="sub">{client.staff_contact_point}</span>
                    </td>
                    <td data-label="Contact">
                      {client.contact_name}
                      <span className="sub">{describeEmails(client.contact_emails)}</span>
                    </td>
                    <td data-label="Phone" className="mono sm">
                      {client.phone}
                    </td>
                    <td data-label="Rate card roles">
                      {client.rate_card_roles.length === 0 ? (
                        <span className="muted sm">no rate card yet</span>
                      ) : (
                        <div className="chips">
                          {client.rate_card_roles.map((role) => (
                            <Chip key={role}>{role}</Chip>
                          ))}
                        </div>
                      )}
                    </td>
                    <td data-label="Policies" className="sm">
                      <span className="muted">Breaks:</span>{' '}
                      {client.pays_breaks ? 'paid' : 'unpaid'} ·{' '}
                      <span className="muted">Buffer:</span>{' '}
                      {client.pays_buffer ? 'paid' : 'strict'}
                    </td>
                    <td data-label="Events" className="num">
                      {client.event_count}
                    </td>
                    {ratesVisible ? (
                      <td data-label="Avg margin" className="num margin">
                        {client.avg_margin_pct === null ? (
                          <span className="muted">—</span>
                        ) : (
                          `${client.avg_margin_pct.toFixed(1)}%`
                        )}
                      </td>
                    ) : null}
                    <td data-label="Date added" className="sm">
                      {/* An audit stamp: UK date only, never the viewer's zone (§1.8). */}
                      <time dateTime={client.created_at}>{formatDateAdded(client.created_at)}</time>
                    </td>
                    <td data-label="Added by" className="sm">
                      {client.created_by_name ?? <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > PAGE_SIZE ? (
          <div className="panel-h pager">
            <span className="muted sm">
              Showing {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + shown.length} of{' '}
              {filtered.length}
            </span>
            <div className="right">
              <Button
                size="sm"
                tone="ghost"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                ‹ Prev
              </Button>
              <span className="mono sm">
                {current + 1} / {pages}
              </span>
              <Button
                size="sm"
                tone="ghost"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                Next ›
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Note>
        A client record can be edited at any time but <b>never deleted</b>. Charge rates and dress
        codes are per client, per role — set on the client card, nowhere else.
      </Note>

      {editing !== null ? (
        <ClientModal
          key={editing === 'new' ? 'new' : editing.id}
          client={editing === 'new' ? null : editing}
          onClose={close}
          onSaved={saved}
        />
      ) : null}
    </OfficeShell>
  );
}

/** "events@leonardo.example +1" — the wireframe's shorthand for several. */
function describeEmails(emails: string[]): string {
  const first = emails[0];
  if (!first) return 'no contact email';
  return emails.length === 1 ? first : `${first} +${emails.length - 1}`;
}

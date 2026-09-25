'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Chip, EmptyState, Note, Panel, Select, TableScroll } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { ClientModal } from './ClientModal';
import type { Client } from './types';
import './clients.css';

export interface ClientsScreenProps {
  clients: Client[];
  problem: string | null;
}

type Sort = 'name' | 'events' | 'margin';

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
export function ClientsScreen({ clients, problem }: ClientsScreenProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [page, setPage] = useState(0);
  /** `null` = closed, `'new'` = create, a client = edit it. */
  const [editing, setEditing] = useState<Client | 'new' | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? clients.filter(
          (client) =>
            client.name.toLowerCase().includes(needle) ||
            client.contact_name.toLowerCase().includes(needle) ||
            client.contact_emails.some((email) => email.toLowerCase().includes(needle)),
        )
      : clients;

    const sorted = [...matched];
    if (sort === 'events') sorted.sort((a, b) => b.event_count - a.event_count);
    // Clients with nothing delivered have no margin; they sort last rather
    // than reading as 0% (§9.7).
    else if (sort === 'margin') {
      sorted.sort((a, b) => (b.avg_margin_pct ?? -1) - (a.avg_margin_pct ?? -1));
    } else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [clients, query, sort]);

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
          <option value="margin">Sort: margin</option>
        </Select>
        <div className="right">
          <span className="muted sm">
            Average margin = (charge − final pay) ÷ charge across completed events, after holiday
            pay
          </span>
        </div>
      </div>

      <Panel flush>
        <div className="panel-b tight">
          {shown.length === 0 ? (
            <EmptyState>
              <h3>{clients.length === 0 ? 'No clients yet' : 'No client matches that search'}</h3>
              <p>
                {clients.length === 0
                  ? 'A client has to exist before an event can be built for it.'
                  : 'Search runs over the client name, the contact and the contact emails.'}
              </p>
            </EmptyState>
          ) : (
            <TableScroll>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Rate card roles</th>
                    <th>Policies</th>
                    <th className="num">Events</th>
                    <th className="num">Avg margin</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((client) => (
                    <tr key={client.id}>
                      <td className="name">
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
                      <td>
                        {client.contact_name}
                        <span className="sub">{describeEmails(client.contact_emails)}</span>
                      </td>
                      <td className="mono sm">{client.phone}</td>
                      <td>
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
                      <td className="sm">
                        <span className="muted">Breaks:</span>{' '}
                        {client.pays_breaks ? 'paid' : 'unpaid'} ·{' '}
                        <span className="muted">Buffer:</span>{' '}
                        {client.pays_buffer ? 'paid' : 'strict'}
                      </td>
                      <td className="num">{client.event_count}</td>
                      <td className="num margin">
                        {client.avg_margin_pct === null ? (
                          <span className="muted">—</span>
                        ) : (
                          `${client.avg_margin_pct.toFixed(1)}%`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
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
        A client record can be edited at any time but <b>never deleted</b> (§9.7). Charge rates and
        dress codes are per client, per role — set on the client card, nowhere else.
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

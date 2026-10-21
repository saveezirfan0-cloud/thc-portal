'use client';

import Link from 'next/link';
import { type MouseEvent, type ReactNode, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Chip,
  ColumnCells,
  ColumnChooser,
  ColumnHeads,
  EmptyState,
  Note,
  Panel,
  Select,
  TableScroll,
  toast,
  useColumns,
} from '@thc/ui';
import type { ColumnDef } from '@thc/ui';
import { AddedFilters } from '../_components/AddedFilters';
import { OfficeShell } from '../_components/OfficeShell';
import { useConfirm } from '../_components/useConfirm';
import { Pager } from '../_components/Pager';
import {
  addedFilterActive,
  formatDateAdded,
  matchesAdded,
  type AddedFilter,
} from '../_lib/addedBy';
import { oneOf, pageIndex, pageParam, sizeOf, useListQuery } from '../_lib/listQuery';
import { DEFAULT_LIST_PAGE_SIZE, LIST_PAGE_SIZES } from '../_lib/pageSizes';
import { setClientsOneOff } from './actions';
import { ClientModal } from './ClientModal';
import type { Client } from './types';
import './clients.css';

export interface ClientsScreenProps {
  clients: Client[];
  problem: string | null;
  /** ADR-0061: false for an office role without finance — no margin anywhere. */
  ratesVisible?: boolean;
  /** Office roles that may write (ADR-0060): the bulk one-off button is drawn for these only. */
  canWrite?: boolean;
}

type Sort = 'name' | 'events' | 'margin' | 'newest' | 'oldest';
type PolicyFilter = 'all' | 'paid' | 'unpaid';
type BufferFilter = 'all' | 'paid' | 'strict';
/** ADR-0186: regular clients lead; one-off ones are a click away. */
type TypeFilter = 'regular' | 'one_off' | 'all';
/** How often the client has ordered: `once` is one event or none. */
type OrdersFilter = 'all' | 'once' | 'repeat';

/** The Rate-card-role filter's value for clients with an empty rate card. */
const NO_RATE_CARD = '\u0000none';

/**
 * The pager's sizes. The wireframe draws a fixed 8; the office asked to pick
 * how many rows a page holds (ADR-0124). 25 by default fits today's
 * directory on one page.
 */
export const PAGE_SIZES = LIST_PAGE_SIZES;
const DEFAULT_PAGE_SIZE = DEFAULT_LIST_PAGE_SIZE;

const SORTS: readonly Sort[] = ['name', 'events', 'margin', 'newest', 'oldest'];
const POLICIES: readonly PolicyFilter[] = ['all', 'paid', 'unpaid'];
const BUFFERS: readonly BufferFilter[] = ['all', 'paid', 'strict'];
const TYPES: readonly TypeFilter[] = ['regular', 'one_off', 'all'];
const ORDERS: readonly OrdersFilter[] = ['all', 'once', 'repeat'];

/**
 * The directory's columns, declared once (ADR-0139). Client stays first;
 * Avg margin is money and is neither drawn nor offered without finance
 * (ADR-0061).
 */
const COLUMNS = [
  { id: 'client', label: 'Client', required: true },
  { id: 'contact', label: 'Contact' },
  { id: 'phone', label: 'Phone', className: 'col-phone', rem: 9 },
  { id: 'roles', label: 'Rate card roles' },
  { id: 'policies', label: 'Policies', width: 'm' },
  { id: 'events', label: 'Events', width: 'xs', className: 'num' },
  { id: 'margin', label: 'Avg margin', width: 's', className: 'num', finance: true },
  { id: 'added', label: 'Date added', width: 's' },
  { id: 'by', label: 'Added by', width: 's' },
] as const satisfies readonly ColumnDef[];
type ColumnId = (typeof COLUMNS)[number]['id'];

/** Search, sort, filters and page live in the URL (release audit L1). */
const QUERY = {
  q: '',
  sort: 'name',
  breaks: 'all',
  buffer: 'all',
  type: 'regular',
  orders: 'all',
  role: '',
  by: '',
  from: '',
  to: '',
  page: '1',
  size: String(DEFAULT_PAGE_SIZE),
} as const satisfies Record<string, string>;

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
export function ClientsScreen({
  clients,
  problem,
  ratesVisible = true,
  canWrite = false,
}: ClientsScreenProps) {
  const router = useRouter();
  const [url, setUrl] = useListQuery(QUERY);
  const query = url.q;
  const sort = oneOf(url.sort, SORTS, 'name');
  const page = pageIndex(url.page);
  const pageSize = sizeOf(url.size, PAGE_SIZES, DEFAULT_PAGE_SIZE);
  const breaks = oneOf(url.breaks, POLICIES, 'all');
  const buffer = oneOf(url.buffer, BUFFERS, 'all');
  const type = oneOf(url.type, TYPES, 'regular');
  const orders = oneOf(url.orders, ORDERS, 'all');
  const role = url.role;
  const added: AddedFilter = useMemo(
    () => ({ by: url.by, from: url.from, to: url.to }),
    [url.by, url.from, url.to],
  );
  const columns = useColumns('clients', COLUMNS, { finance: ratesVisible });
  /** `null` = closed, `'new'` = create, a client = edit it. */
  const [editing, setEditing] = useState<Client | 'new' | null>(null);

  const roles = useMemo(
    () => [...new Set(clients.flatMap((client) => client.rate_card_roles))].sort(),
    [clients],
  );
  const hasEmptyRateCard = clients.some((client) => client.rate_card_roles.length === 0);

  const oneOffCount = useMemo(() => clients.filter((client) => client.one_off).length, [clients]);
  const confirm = useConfirm();
  const [marking, setMarking] = useState(false);

  // `type` is a view, not a narrowing filter: it is not cleared by "Clear
  // filters" and does not count as one, so the default (regular clients)
  // never makes a short list read as "filtered".
  const filtersActive =
    breaks !== 'all' ||
    buffer !== 'all' ||
    orders !== 'all' ||
    role !== '' ||
    addedFilterActive(added);

  // Every filter change goes back to the first page: the pager would
  // otherwise be left past the end of a shorter list.
  const clearFilters = () =>
    setUrl({
      breaks: 'all',
      buffer: 'all',
      orders: 'all',
      role: '',
      by: '',
      from: '',
      to: '',
      page: '1',
    });

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
      if (type === 'regular' && client.one_off) return false;
      if (type === 'one_off' && !client.one_off) return false;
      if (orders === 'once' && client.event_count > 1) return false;
      if (orders === 'repeat' && client.event_count < 2) return false;
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
  }, [clients, query, type, orders, breaks, buffer, role, added, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * pageSize, current * pageSize + pageSize);

  // The whole row opens the card, as the wireframe's `tr.clickable` does:
  // only the name was a link, so a click anywhere else on the row — the
  // contact line under the name included — did nothing. The name keeps its
  // Link for the keyboard and for "open in a new tab".
  const openClient = (id: string) => (event: MouseEvent<HTMLTableRowElement>) => {
    // The name's own link (or any other control) already navigates.
    if ((event.target as HTMLElement).closest('a, button')) return;
    // Selecting a phone number or an email to copy it is not a click.
    if (window.getSelection()?.toString()) return;
    router.push(`/clients/${id}`);
  };

  // ADR-0186: the whole filtered list, not the page, so "Ordered once or
  // never" + this is one step for a long tail of private events.
  const markShown = (oneOff: boolean) => {
    const ids = filtered.map((client) => client.id);
    const n = ids.length;
    const noun = `${n} client${n === 1 ? '' : 's'}`;
    confirm.ask({
      title: oneOff ? `Mark ${noun} as one-off?` : `Move ${noun} back to regular?`,
      body: oneOff
        ? `They stop leading the lists workers are qualified from and move to the One-off view here. Nothing is deleted or blocked: events can still be built for them, qualified staff stay qualified, and auto-assign is unchanged. Each one has the switch on its card to undo it.`
        : `They lead the lists workers are qualified from again.`,
      confirm: oneOff ? `Mark ${noun} as one-off` : `Move ${noun} back`,
      onConfirm: () => {
        setMarking(true);
        void setClientsOneOff(ids, oneOff).then((result) => {
          setMarking(false);
          if (result.ok) {
            toast(oneOff ? `${noun} marked as one-off` : `${noun} moved back to regular`, {
              tone: 'green',
            });
            router.refresh();
          } else {
            toast(result.message, { tone: 'coral' });
          }
        });
      },
    });
  };

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

      <div className="toolbar filters">
        <div className="search">
          <input
            className="input"
            style={{ width: 280 }}
            type="search"
            value={query}
            onChange={(event) => setUrl({ q: event.target.value, page: '1' }, 'replace')}
            placeholder="Search client, contact, email"
            aria-label="Search client, contact, email"
          />
        </div>
        <Select
          value={sort}
          onChange={(event) => setUrl({ sort: event.target.value })}
          aria-label="Sort clients"
          style={{ width: 190 }}
        >
          <option value="name">Sort: name A–Z</option>
          <option value="events">Sort: most events</option>
          <option value="newest">Sort: newest added</option>
          <option value="oldest">Sort: oldest added</option>
          {ratesVisible ? <option value="margin">Sort: margin</option> : null}
        </Select>
        <ColumnChooser columns={columns} label="Clients" />
        {ratesVisible ? (
          <div className="right">
            <span className="muted sm">
              Average margin = (charge − final pay) ÷ charge across completed events, after holiday
              pay
            </span>
          </div>
        ) : null}
      </div>

      <div className="toolbar filters" role="group" aria-label="Client filters">
        <Select
          value={type}
          onChange={(event) => setUrl({ type: event.target.value, page: '1' })}
          aria-label="Regular or one-off clients"
          style={{ width: 200 }}
        >
          <option value="regular">Regular clients ({clients.length - oneOffCount})</option>
          <option value="one_off">One-off clients ({oneOffCount})</option>
          <option value="all">All clients ({clients.length})</option>
        </Select>
        <Select
          value={orders}
          onChange={(event) => setUrl({ orders: event.target.value, page: '1' })}
          aria-label="Filter by how often the client has ordered"
          style={{ width: 200 }}
        >
          <option value="all">Events: any</option>
          <option value="once">Ordered once or never</option>
          <option value="repeat">Ordered more than once</option>
        </Select>
        <Select
          value={breaks}
          onChange={(event) => setUrl({ breaks: event.target.value, page: '1' })}
          aria-label="Filter by break policy"
          style={{ width: 160 }}
        >
          <option value="all">Breaks: all</option>
          <option value="paid">Breaks: paid</option>
          <option value="unpaid">Breaks: unpaid</option>
        </Select>
        <Select
          value={buffer}
          onChange={(event) => setUrl({ buffer: event.target.value, page: '1' })}
          aria-label="Filter by buffer policy"
          style={{ width: 160 }}
        >
          <option value="all">Buffer: all</option>
          <option value="paid">Buffer: paid</option>
          <option value="strict">Buffer: strict</option>
        </Select>
        <Select
          value={role}
          onChange={(event) => setUrl({ role: event.target.value, page: '1' })}
          aria-label="Filter by rate card role"
          style={{ width: 190 }}
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
          onChange={(next) => setUrl({ by: next.by, from: next.from, to: next.to, page: '1' })}
        />
        <div className="right row">
          {canWrite && type !== 'all' && filtered.length > 0 ? (
            <Button
              size="sm"
              tone={type === 'regular' ? 'primary' : 'ghost'}
              disabled={marking}
              onClick={() => markShown(type === 'regular')}
            >
              {type === 'regular'
                ? `Mark the ${filtered.length} shown as one-off`
                : `Move the ${filtered.length} shown back to regular`}
            </Button>
          ) : null}
          {filtersActive ? (
            <Button size="sm" tone="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
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
                    : type !== 'all' && clients.length > 0
                      ? 'Search runs over the client name, the contact and the contact emails. Regular and one-off clients are listed apart; All shows both.'
                      : 'Search runs over the client name, the contact and the contact emails.'}
              </p>
            </EmptyState>
          ) : (
            <TableScroll label="Clients" fixed minWidth={columns.minWidth('58rem')}>
              <table className="tbl card-rows clients-list">
                <thead>
                  <tr>
                    <ColumnHeads columns={columns} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((client) => {
                    const cells: Record<ColumnId, ReactNode> = {
                      client: (
                        <td className="name cell-title">
                          {/*
                            The name opens the card (§9.7), not the edit modal:
                            the card is where the rate card, the qualified pool
                            and this client's events live, and Edit is one
                            button on it. The row opens it too (openClient).
                          */}
                          <Link href={`/clients/${client.id}`} className="client-name">
                            {client.name}
                          </Link>
                          <span className="sub">{client.staff_contact_point}</span>
                        </td>
                      ),
                      contact: (
                        <td data-label="Contact">
                          {client.contact_name}
                          <span className="sub">{describeEmails(client.contact_emails)}</span>
                        </td>
                      ),
                      phone: (
                        <td data-label="Phone" className="mono sm client-phone">
                          {client.phone}
                        </td>
                      ),
                      roles: (
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
                      ),
                      policies: (
                        <td data-label="Policies" className="sm client-policies">
                          <span className="policy">
                            <span className="muted">Breaks:</span>{' '}
                            {client.pays_breaks ? 'paid' : 'unpaid'}
                          </span>{' '}
                          ·{' '}
                          <span className="policy">
                            <span className="muted">Buffer:</span>{' '}
                            {client.pays_buffer ? 'paid' : 'strict'}
                          </span>
                        </td>
                      ),
                      events: (
                        <td data-label="Events" className="num">
                          {client.event_count}
                        </td>
                      ),
                      // ADR-0061: only drawn when the column is offered at all.
                      margin: (
                        <td data-label="Avg margin" className="num margin">
                          {client.avg_margin_pct === null ? (
                            <span className="muted">—</span>
                          ) : (
                            `${client.avg_margin_pct.toFixed(1)}%`
                          )}
                        </td>
                      ),
                      added: (
                        <td data-label="Date added" className="sm client-nowrap">
                          {/* An audit stamp: UK date only, never the viewer's zone (§1.8). */}
                          <time dateTime={client.created_at}>
                            {formatDateAdded(client.created_at)}
                          </time>
                        </td>
                      ),
                      by: (
                        <td data-label="Added by" className="sm client-nowrap">
                          {client.created_by_name ?? <span className="muted">—</span>}
                        </td>
                      ),
                    };
                    return (
                      <tr key={client.id} className="clickable" onClick={openClient(client.id)}>
                        <ColumnCells columns={columns} cells={cells} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
        {/*
          The pager shows once the list outgrows the smallest size, so the
          size can still be changed while everything fits on one page.
        */}
        {filtered.length > PAGE_SIZES[0] ? (
          <Pager
            total={filtered.length}
            page={current}
            pageSize={pageSize}
            sizes={PAGE_SIZES}
            onPage={(next) => setUrl({ page: pageParam(next) })}
            onPageSize={(size) => setUrl({ size: String(size), page: '1' })}
          />
        ) : null}
      </Panel>

      <Note>
        A client record can be edited at any time but <b>never deleted</b>. Charge rates and dress
        codes are per client, per role — set on the client card, nowhere else.
      </Note>

      {confirm.dialog}

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

'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import {
  Avatar,
  AvatarGroup,
  Button,
  EmptyState,
  Input,
  Panel,
  Pill,
  Progress,
  SearchInput,
  SegToggle,
  Select,
  useViewerZone,
} from '@thc/ui';
import { needsDualZone } from '@thc/domain';
import { Arrivals } from './ArrivalsPill';
import type { ArrivalsByEvent } from './arrivals';
import { EventWindow } from './EventWindow';
import { ukDateShort } from './format';
import {
  NO_FILTERS,
  applyFilters,
  byDateDescending,
  documentOffer,
  emptyReason,
  eventsPanelTitle,
  feedbackToGo,
  fillOf,
  filterByTab,
  filtersActive,
  isRemoved,
  momentIn,
  nextUp,
  roleBreakdown,
  statusTone,
  timesheetStatus,
  venuesOf,
} from './rules';
import type {
  DocumentKind,
  DocumentOffer,
  EventFilters,
  LineupRow,
  PortalEvent,
  RoleSection,
  Tab,
} from './rules';

/**
 * §11.1 · the customer's event list.
 *
 * Columns, in the order the scope names them: name · venue · date/time ·
 * "N of M confirmed" · photos of the confirmed workers · a button to
 * download the document · a link into the details.
 *
 * There is no money column, and there is nothing to add one from: the rows
 * come from `client_events_v` and `client_role_sections_v`, neither of
 * which carries a rate (§11.1).
 *
 * ADR-0049 adds presentation only, from the same rows: a "Next up" strip, a
 * per-role breakdown under the fill bar, a feedback nudge, the signed
 * timesheet's status, venue and date filters, and an empty state that says
 * why it is empty. No new data, no editing, no money.
 *
 * A client component because the tabs, the filters and the viewer's own
 * time zone are all browser facts. The rows themselves were fetched on the
 * server, under the caller's session.
 */
const FACES_SHOWN = 6;

const STATUS_LABEL: Record<PortalEvent['status'], string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DOC_LABEL = { allocation: '↓ Allocation sheet', signout: '↓ Signed timesheet' } as const;

const TAB_EMPTY: Record<Tab, string> = {
  upcoming: 'You have no upcoming or ongoing events.',
  past: 'You have no past events yet.',
  all: 'You have no events yet.',
};

export function EventsScreen({
  events,
  sections,
  lineup,
  photos,
  documents = {},
  company = null,
  arrivals = {},
  now,
}: {
  events: PortalEvent[];
  sections: RoleSection[];
  lineup: LineupRow[];
  photos: Record<string, string>;
  /** Which §11.3 PDFs the office has issued, per event (`client_event_documents_v`). */
  documents?: Record<string, DocumentKind[]>;
  /** The caller's own company (`client_company_v`): "Events · <client>". */
  company?: string | null;
  /** On-the-day check-in counts per event (ADR-0053); counts only, never who. */
  arrivals?: ArrivalsByEvent;
  /** Fixed on the server so the first paint cannot disagree with hydration. */
  now: string;
}) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [filters, setFilters] = useState<EventFilters>(NO_FILTERS);
  const set = (patch: Partial<EventFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const at = useMemo(() => new Date(now), [now]);

  const counts = useMemo(
    () => ({
      upcoming: filterByTab(events, 'upcoming', at).length,
      past: filterByTab(events, 'past', at).length,
    }),
    [events, at],
  );

  const venues = useMemo(() => venuesOf(events), [events]);
  const next = useMemo(() => nextUp(events, at), [events, at]);

  const inTab = useMemo(() => filterByTab(events, tab, at), [events, tab, at]);
  const rows = useMemo(() => byDateDescending(applyFilters(inTab, filters)), [inTab, filters]);
  const filtering = filtersActive(filters);
  const empty = emptyReason(events.length, inTab.length, rows.length);

  const sectionsFor = (id: string) => sections.filter((s) => s.eventId === id);
  const facesFor = (id: string) =>
    lineup.filter((l) => l.eventId === id).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your events</h1>
          <div className="desc">
            Confirmed line-ups and timesheets{company ? ` for ${company}` : ''} · read-only
          </div>
        </div>
        <div className="actions">
          {/* "Upcoming" is upcoming AND ongoing (filterByTab); the longer
              label did not fit three options on a phone (ADR-0049). */}
          <SegToggle
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            options={[
              { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
              { value: 'past', label: 'Past', count: counts.past },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </div>

      {next ? <NextUp {...next} now={at} fill={fillOf(sectionsFor(next.event.id))} /> : null}

      {/* The shared .toolbar phone rules (packages/ui) give the search its
          own line and let the filters share the next one. */}
      <div className="toolbar ev-filters">
        <SearchInput
          label="Search events"
          placeholder="Search events"
          value={filters.query}
          onChange={(e) => set({ query: e.currentTarget.value })}
          className="ev-search"
        />
        <div className="right">
          {venues.length > 1 ? (
            <Select
              label="Venue"
              className="ev-venue"
              value={filters.venue}
              onChange={(e) => set({ venue: e.currentTarget.value })}
            >
              <option value="">All venues</option>
              {venues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          ) : null}
          {/* Calendar days in the UK, inclusive (applyFilters): what the
              Date column prints, not the viewer's own zone. */}
          <Input
            type="date"
            label="From (UK date)"
            className="ev-date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set({ from: e.currentTarget.value })}
          />
          <Input
            type="date"
            label="To (UK date)"
            className="ev-date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set({ to: e.currentTarget.value })}
          />
          {filtering ? (
            <Button
              size="sm"
              tone="ghost"
              className="ev-clear"
              onClick={() => setFilters(NO_FILTERS)}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <Panel
        className="events-panel"
        title={
          <>
            {eventsPanelTitle(company)}{' '}
            <span className="muted sm">only your events · newest first</span>
          </>
        }
        actions={<Pill>{rows.length === 1 ? '1 event' : `${rows.length} events`}</Pill>}
        flush
      >
        {empty ? (
          <EmptyList
            reason={empty}
            tab={tab}
            hidden={inTab.length}
            onShowAll={() => setTab('all')}
            onClearFilters={() => setFilters(NO_FILTERS)}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Venue</th>
                    <th>Date &amp; time</th>
                    <th>Status</th>
                    <th>Confirmed</th>
                    <th>Line-up</th>
                    <th>Document</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const secs = sectionsFor(e.id);
                    const fill = fillOf(secs);
                    const faces = facesFor(e.id);
                    const doc = documentOffer(e.status, documents[e.id] ?? []);
                    const sheet = timesheetStatus(e.status, documents[e.id] ?? []);
                    const nudge = feedbackToGo(e, faces, at);
                    const cancelled = e.status === 'cancelled';

                    return (
                      <tr key={e.id} className={cancelled ? 'cancelled' : undefined}>
                        <td>
                          <b>{cancelled ? <s>{e.title}</s> : e.title}</b>
                          <span className="sub">{e.poNumber ? `PO ${e.poNumber}` : 'PO —'}</span>
                        </td>
                        <td>
                          {e.venueName}
                          <span className="sub">{e.venueAddress}</span>
                        </td>
                        <td className="win">
                          <b>{ukDateShort(e.startsAt)}</b>
                          <EventWindow startsAt={e.startsAt} endsAt={e.endsAt} className="sub" />
                        </td>
                        <td>
                          <div className="stack tight">
                            <Pill tone={statusTone(e.status)} dot={e.status === 'ongoing'}>
                              {STATUS_LABEL[e.status]}
                            </Pill>
                            {nudge ? <FeedbackNudge eventId={e.id} {...nudge} /> : null}
                          </div>
                        </td>
                        <td>
                          {cancelled ? (
                            <span className="muted sm">—</span>
                          ) : (
                            <div className="fill-cell">
                              <span>
                                <b>{fill.confirmed}</b> of {fill.headcount} confirmed
                              </span>
                              <Progress value={fill.percent} tone={fill.tone} />
                              <RoleLine sections={secs} />
                              <Arrivals
                                counts={e.status === 'ongoing' ? arrivals[e.id] : undefined}
                              />
                            </div>
                          )}
                        </td>
                        <td>
                          {cancelled ? (
                            <span className="muted sm">—</span>
                          ) : (
                            <Faces people={faces} photos={photos} />
                          )}
                        </td>
                        <td>
                          <div className="stack tight">
                            <DocumentButton eventId={e.id} offer={doc} />
                            {sheet ? <TimesheetStatus status={sheet} /> : null}
                            <Link className="sm" href={`/client/events/${e.id}`}>
                              Details →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Same rows, no table. The phone drops no field (§1.2). */}
            <div className="cards" style={{ padding: 14 }}>
              {rows.map((e) => {
                const secs = sectionsFor(e.id);
                const fill = fillOf(secs);
                const faces = facesFor(e.id);
                const doc = documentOffer(e.status, documents[e.id] ?? []);
                const sheet = timesheetStatus(e.status, documents[e.id] ?? []);
                const nudge = feedbackToGo(e, faces, at);
                const cancelled = e.status === 'cancelled';

                return (
                  <div key={e.id} className={cancelled ? 'ecard cancelled' : 'ecard'}>
                    <div className="when">
                      <Pill tone={statusTone(e.status)} dot={e.status === 'ongoing'}>
                        {STATUS_LABEL[e.status]}
                      </Pill>
                      <span className="win">
                        <b>{ukDateShort(e.startsAt)}</b>
                        <EventWindow startsAt={e.startsAt} endsAt={e.endsAt} />
                      </span>
                    </div>
                    <div className="t">{e.title}</div>
                    <div className="m">
                      {e.venueName}, {e.venueAddress}
                      {e.poNumber ? ` · PO ${e.poNumber}` : ''}
                    </div>
                    {cancelled ? null : (
                      <div className="ev-fill">
                        <div className="faces">
                          <Faces people={faces} photos={photos} />
                          <span className="sm">
                            <b>{fill.confirmed}</b> of {fill.headcount} confirmed
                          </span>
                        </div>
                        <Progress value={fill.percent} tone={fill.tone} />
                        <RoleLine sections={secs} />
                        <Arrivals counts={e.status === 'ongoing' ? arrivals[e.id] : undefined} />
                      </div>
                    )}
                    {nudge || sheet ? (
                      <div className="ev-notes">
                        {nudge ? <FeedbackNudge eventId={e.id} {...nudge} /> : null}
                        {sheet ? <TimesheetStatus status={sheet} /> : null}
                      </div>
                    ) : null}
                    <div className="foot">
                      <DocumentButton eventId={e.id} offer={doc} />
                      <Link className="btn sm" href={`/client/events/${e.id}`}>
                        Details →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

/**
 * An empty list that says why (ADR-0049, reason from `emptyReason`): the
 * customer has no events yet; this tab has none, which the filters cannot
 * change, so the way out is another tab; or the search and filters hid
 * every row of the tab, so the way out is "Clear filters".
 */
export function EmptyList({
  reason,
  tab,
  hidden,
  onShowAll,
  onClearFilters,
}: {
  reason: 'none' | 'tab' | 'filters';
  tab: Tab;
  /** How many rows of this tab the filters are hiding. */
  hidden: number;
  onShowAll: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div className="ev-empty">
      {reason === 'none' ? (
        <EmptyState>
          <h3>No events yet</h3>
          <p>When THC books staff for one of your events, it appears here.</p>
        </EmptyState>
      ) : reason === 'tab' ? (
        <EmptyState>
          <h3>Nothing here</h3>
          <p>{TAB_EMPTY[tab]}</p>
          <Button size="sm" className="mt-16" onClick={onShowAll}>
            Show all events
          </Button>
        </EmptyState>
      ) : (
        <EmptyState>
          <h3>No events match your filters</h3>
          <p>
            {hidden === 1
              ? '1 event in this tab is hidden by your search and filters.'
              : `${hidden} events in this tab are hidden by your search and filters.`}
          </p>
          <Button size="sm" className="mt-16" onClick={onClearFilters}>
            Clear filters
          </Button>
        </EmptyState>
      )}
    </div>
  );
}

/**
 * "Next · Gala Dinner · today 07:00 UK time · 13 of 17 confirmed", or
 * "Happening now: …" while one is running (ADR-0049). Independent of the tab
 * and the filters: it answers "what is next for me", not "what is in this
 * view". A scheduled time, so dual zone (§1.8): the UK line is rendered on
 * the server, and the viewer's own "your time" is added once mounted, only
 * when their zone differs — the same hydration rule as `EventWindow`.
 */
function NextUp({
  event,
  live,
  when,
  at,
  dropToday,
  now,
  fill,
}: {
  event: PortalEvent;
  live: boolean;
  when: string;
  at: string;
  dropToday: boolean;
  now: Date;
  fill: { confirmed: number; headcount: number };
}) {
  const zone = useViewerZone();
  const mine = needsDualZone(zone) ? momentIn(at, now, dropToday, zone) : null;
  return (
    <Link className={live ? 'ev-next live' : 'ev-next'} href={`/client/events/${event.id}`}>
      <Pill tone={live ? 'green' : 'cyan'} dot={live}>
        {live ? 'Happening now' : 'Next'}
      </Pill>
      <span className="ev-next-t">
        <b>{event.title}</b>
        <span> · {when}</span>
        {mine ? <span className="muted"> ({live ? `until ${mine}` : mine} your time)</span> : null}
        <span>
          {' '}
          · {fill.confirmed} of {fill.headcount} confirmed
        </span>
      </span>
      <span className="ev-next-go" aria-hidden>
        →
      </span>
    </Link>
  );
}

/**
 * The per-role split under the fill bar: "Waiting 8/10 · Bar 5/7" (§11.1,
 * ADR-0049). Confirmed only, against the booked headcount (§3.2). A single
 * role would only repeat "N of M confirmed", so it draws nothing then.
 */
function RoleLine({ sections }: { sections: RoleSection[] }) {
  const roles = roleBreakdown(sections);
  if (roles.length < 2) return null;
  return (
    <span className="ev-roles">
      {/* The separator sits outside the role's own span, so a narrow cell
          breaks between roles and never inside "Waiting Staff 8/10". */}
      {roles.map((r, i) => (
        <Fragment key={r.role}>
          {i > 0 ? ' · ' : ''}
          <span className={r.short ? 'short' : undefined}>
            {r.role} {r.confirmed}/{r.headcount}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * "Leave feedback · 5 of 13 to go" (§11.2, ADR-0049). A link to the event
 * page, where the per-worker buttons are; the list itself writes nothing.
 */
function FeedbackNudge({ eventId, toGo, total }: { eventId: string; toGo: number; total: number }) {
  return (
    <Link className="ev-nudge" href={`/client/events/${eventId}`}>
      Leave feedback · {toGo} of {total} to go
    </Link>
  );
}

/**
 * A completed event's signed timesheet, said in words (§11.3, ADR-0049).
 * Exported for its test: static rendering always opens on the Upcoming
 * tab, where no completed event is listed.
 */
export function TimesheetStatus({ status }: { status: 'ready' | 'pending' }) {
  return status === 'ready' ? (
    <span className="ev-sheet ready">✓ Signed timesheet ready</span>
  ) : (
    <span className="ev-sheet">Timesheet not issued yet</span>
  );
}

/**
 * The row's document (§11.1, §11.3): a real download (an `<a href>` to the
 * PDF, so it can be saved or forwarded from a phone, §11.4) once the office
 * has issued that kind; the same label, disabled, until it has; and the
 * wireframe's "No document" for a cancelled event.
 *
 * A live download is the row's primary action, filled (ADR-0049): next to
 * the bordered "Details →" the plain `btn` read as greyed out. The disabled
 * stub stays the plain, faded button, so a copy not yet issued still looks
 * unavailable rather than like a primary that does nothing.
 */
function DocumentButton({ eventId, offer }: { eventId: string; offer: DocumentOffer | null }) {
  if (!offer) return <span className="muted sm">No document</span>;
  if (offer.available) {
    return (
      <a className="btn sm primary" href={`/client/events/${eventId}/document?kind=${offer.kind}`}>
        {DOC_LABEL[offer.kind]}
      </a>
    );
  }
  return (
    <Button size="sm" disabled title="THC has not issued this document yet">
      {DOC_LABEL[offer.kind]}
    </Button>
  );
}

/**
 * The faces on a row (§11.1): "photos of the confirmed workers (not
 * initials — so the customer recognises the people by face)". Initials are
 * the fallback when a worker has no selfie yet; a removed worker keeps
 * their slot with no photo at all, so the headcount is not skewed (§1.7).
 */
function Faces({ people, photos }: { people: LineupRow[]; photos: Record<string, string> }) {
  const shown = people.slice(0, FACES_SHOWN);
  const extra = people.length - shown.length;

  return (
    <AvatarGroup>
      {shown.map((p) => (
        <Avatar
          key={p.bookingId}
          name={p.name}
          size="sm"
          src={p.photoPath ? photos[p.photoPath] : undefined}
          deleted={isRemoved(p)}
        />
      ))}
      {extra > 0 ? (
        <span className="more" title={`${extra} more confirmed`}>
          +{extra}
        </span>
      ) : null}
    </AvatarGroup>
  );
}

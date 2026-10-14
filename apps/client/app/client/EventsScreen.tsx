'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Avatar,
  AvatarGroup,
  Button,
  EmptyState,
  Panel,
  Pill,
  Progress,
  SearchInput,
  SegToggle,
  Select,
  UkDateField,
  useViewerZone,
} from '@thc/ui';
import { needsDualZone, ukToday } from '@thc/domain';
import { AsOf } from '../_components/AsOf';
import { Arrivals } from './ArrivalsPill';
import { CalendarAllButton } from './CalendarAllButton';
import { WelcomePanel } from './WelcomePanel';
import type { ArrivalsByEvent } from './arrivals';
import { DocumentLink } from './DocumentLink';
import { EventWindow } from './EventWindow';
import { reversedRangeText } from './ukdate';
import { ukDateShort, ukDayMonth } from './format';
import {
  FACES_SHOWN,
  NO_FILTERS,
  applyFilters,
  arrivalsWithinHeadcount,
  documentOffer,
  documentPendingLine,
  emptyReason,
  eventsPanelTitle,
  feedbackToGo,
  fillOf,
  filterByTab,
  filtersActive,
  isRemoved,
  lineupNames,
  listQuery,
  listStateFromParams,
  momentIn,
  nextUp,
  orderLabel,
  rangeReversed,
  roleBreakdown,
  sortForTab,
  staffMatching,
  statusTone,
  tabCounts,
  timesheetStatus,
  venuesOf,
} from './rules';
import { dayLabel, olderQuery, pastWindow, sameWindow, withSince } from './window';
import type { LoadedHistory } from './window';
import type {
  DocumentKind,
  EventFilters,
  LineupRow,
  ListState,
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
 * server, under the caller's session. The tab and the filters ride in the
 * address bar (`?tab=past&q=gala`), so Back from an event page and a
 * reload land on the view the customer left (`useListState`).
 */
const STATUS_LABEL: Record<PortalEvent['status'], string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DOC_LABEL = {
  allocation: '↓ Allocation Timesheet',
  signout: '↓ Completed Timesheet',
} as const;

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
  loaded,
  now,
}: {
  events: PortalEvent[];
  sections: RoleSection[];
  lineup: LineupRow[];
  /** Signed photo URLs keyed by `bookingId` (photos.ts); never a Storage path. */
  photos: Record<string, string>;
  /** Which §11.3 PDFs the office has issued, per event (`client_event_documents_v`). */
  documents?: Record<string, DocumentKind[]>;
  /** The caller's own company (`client_company_v`): "Events · <client>". */
  company?: string | null;
  /** On-the-day check-in counts per event (ADR-0053); counts only, never who. */
  arrivals?: ArrivalsByEvent;
  /**
   * The past window the page read (window.ts): a date filter reaching outside
   * it re-reads on the server, and "Show older events" pages further back.
   */
  loaded?: LoadedHistory;
  /** Fixed on the server so the first paint cannot disagree with hydration. */
  now: string;
}) {
  const [{ tab, filters }, setList, olderHref] = useListState(loaded, now);
  const setTab = (next: Tab) => setList({ tab: next, filters });
  const setFilters = (next: EventFilters) => setList({ tab, filters: next });
  const set = (patch: Partial<EventFilters>) => setFilters({ ...filters, ...patch });
  const router = useRouter();

  const at = useMemo(() => new Date(now), [now]);

  // Live events only: a cancelled one is listed, greyed, but not counted.
  const counts = useMemo(() => tabCounts(events, at), [events, at]);

  const venues = useMemo(() => venuesOf(events), [events]);
  const next = useMemo(() => nextUp(events, at), [events, at]);

  const inTab = useMemo(() => filterByTab(events, tab, at), [events, tab, at]);
  // "Which events was Priya on?" (ADR-0134 N5): the search also reads the
  // names on each loaded line-up — the window read, never further.
  const names = useMemo(() => lineupNames(lineup), [lineup]);
  const rows = useMemo(
    () => sortForTab(applyFilters(inTab, filters, names), tab),
    [inTab, filters, names, tab],
  );
  const staffFor = (id: string) => staffMatching(names.get(id), filters.query);
  const filtering = filtersActive(filters);
  const reversed = rangeReversed(filters);
  const empty = emptyReason(events.length, inTab.length, rows.length, reversed);

  const sectionsFor = (id: string) => sections.filter((s) => s.eventId === id);
  const facesFor = (id: string) =>
    lineup.filter((l) => l.eventId === id).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  // "N of M arrived" while the event runs (ADR-0053), each section held to
  // its headcount like "N of M confirmed", so the buffer stays internal.
  const arrivalsFor = (e: PortalEvent, secs: RoleSection[]) =>
    e.status === 'ongoing' ? arrivalsWithinHeadcount(arrivals[e.id], secs) : undefined;

  /**
   * The whole row opens the event, as the wireframe's `tr.clickable` does.
   * The row is not a control of its own — not focusable, no role — because
   * its "Details →" link is the real target for a keyboard or a screen
   * reader; this only widens the mouse and touch target. A click that
   * lands on the row's own link or button is theirs, and a click that ends
   * a text selection is a selection, not a navigation.
   */
  const openRow = (href: string) => (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as Element).closest('a, button, input, select, label')) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your events</h1>
          <div className="desc">
            Confirmed line-ups and timesheets{company ? ` for ${company}` : ''} · read-only ·{' '}
            <AsOf now={now} />
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

      {/* First visit on this device only (ADR-0134 N8). */}
      <WelcomePanel />

      {next ? <NextUp {...next} now={at} fill={fillOf(sectionsFor(next.event.id))} /> : null}

      {/* The shared .toolbar phone rules (packages/ui) give the search its
          own line and let the filters share the next one. */}
      <div className="toolbar ev-filters">
        <SearchInput
          label="Search events or staff"
          placeholder="Search events or staff"
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
              Date column prints, not the viewer's own zone. Typed dd/mm/yyyy
              whatever the device's locale (UkDateField). */}
          <UkDateField
            label="From (UK date)"
            className="ev-date"
            value={filters.from}
            onChange={(from) => set({ from })}
          />
          <UkDateField
            label="To (UK date)"
            className="ev-date"
            value={filters.to}
            onChange={(to) => set({ to })}
            error={reversed ? 'Before the “From” date.' : null}
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
            <span className="muted sm ev-qual">only your events · {orderLabel(tab)}</span>
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
            range={reversed ? { from: filters.from, to: filters.to } : undefined}
            onSwapDates={() => set({ from: filters.to, to: filters.from })}
            older={olderHref && loaded ? { since: loaded.since, href: olderHref } : undefined}
            searching={filters.query.trim() !== ''}
          />
        ) : (
          <>
            {/* A plain sideways scroller inside the card: at laptop width the
                table fits once the Venue column folds under the event name
                (≤1279px, as the wireframe's tablet note says); this only
                catches whatever is left, and never scrolls vertically. */}
            <div className="ev-table">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th className="col-venue">Venue</th>
                    <th>Date &amp; time</th>
                    <th className="col-status">Status</th>
                    <th>Confirmed</th>
                    <th className="col-lineup">Line-up</th>
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
                    const here = arrivalsFor(e, secs);
                    const href = `/client/events/${e.id}`;
                    // Its own column on a wide screen, under the date once
                    // that column folds; rendered in both, the CSS shows one.
                    const status = (
                      <>
                        <Pill tone={statusTone(e.status)} dot={e.status === 'ongoing'}>
                          {STATUS_LABEL[e.status]}
                        </Pill>
                        {nudge ? <FeedbackNudge eventId={e.id} {...nudge} /> : null}
                      </>
                    );

                    return (
                      <tr
                        key={e.id}
                        className={cancelled ? 'cancelled' : 'clickable'}
                        onClick={cancelled ? undefined : openRow(href)}
                      >
                        <td>
                          <b>{cancelled ? <s>{e.title}</s> : e.title}</b>
                          <span className="sub">{e.poNumber ? `PO ${e.poNumber}` : 'PO —'}</span>
                          <StaffMatch names={staffFor(e.id)} />
                          {cancelled && e.cancelledAt ? (
                            <span className="sub">cancelled {ukDayMonth(e.cancelledAt)}</span>
                          ) : null}
                          {/* Shown only once the Venue column folds (≤1279px). */}
                          <span className="sub venue-inline">
                            {e.venueName}, {e.venueAddress}
                          </span>
                        </td>
                        <td className="col-venue">
                          {e.venueName}
                          <span className="sub">{e.venueAddress}</span>
                        </td>
                        <td className="win">
                          <b>{ukDateShort(e.startsAt)}</b>
                          <EventWindow
                            startsAt={e.startsAt}
                            endsAt={e.endsAt}
                            className="sub"
                            breakable
                          />
                          {/* Shown only once the Status column folds (≤1100px). */}
                          <div className="stack tight status-inline">{status}</div>
                        </td>
                        <td className="col-status">
                          <div className="stack tight">{status}</div>
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
                              <Arrivals counts={here} />
                              {/* Shown only once the Line-up column folds (≤1279px). */}
                              <div className="faces-inline">
                                <Faces people={faces} photos={photos} />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="col-lineup">
                          {cancelled ? (
                            <span className="muted sm">—</span>
                          ) : (
                            <Faces people={faces} photos={photos} />
                          )}
                        </td>
                        <td>
                          <div className="stack tight ev-doc">
                            <DocumentButton event={e} offer={doc} now={at} />
                            {sheet === 'ready' ? <TimesheetStatus status={sheet} /> : null}
                            <Link
                              className={cancelled ? 'sm muted ev-details' : 'sm ev-details'}
                              href={href}
                            >
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
            <div className="cards">
              {rows.map((e) => {
                const secs = sectionsFor(e.id);
                const fill = fillOf(secs);
                const faces = facesFor(e.id);
                const doc = documentOffer(e.status, documents[e.id] ?? []);
                const sheet = timesheetStatus(e.status, documents[e.id] ?? []);
                const nudge = feedbackToGo(e, faces, at);
                const cancelled = e.status === 'cancelled';
                const ready = sheet === 'ready';

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
                    <div className="t">{cancelled ? <s>{e.title}</s> : e.title}</div>
                    <StaffMatch names={staffFor(e.id)} />
                    <div className="m">
                      {e.venueName}, {e.venueAddress} · {e.poNumber ? `PO ${e.poNumber}` : 'PO —'}
                      {cancelled && e.cancelledAt
                        ? ` · cancelled ${ukDayMonth(e.cancelledAt)}`
                        : ''}
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
                        <Arrivals counts={arrivalsFor(e, secs)} />
                      </div>
                    )}
                    {nudge || ready ? (
                      <div className="ev-notes">
                        {nudge ? <FeedbackNudge eventId={e.id} {...nudge} /> : null}
                        {ready ? <TimesheetStatus status={sheet} /> : null}
                      </div>
                    ) : null}
                    <div className="foot">
                      <DocumentButton event={e} offer={doc} now={at} />
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

      {/* ADR-0134 N7 and N4: every upcoming event in one calendar file, and
          the feedback the customer has left, both a click from the list. */}
      <div className="row wrap ev-foot">
        <CalendarAllButton events={events} now={now} />
        <Link className="btn ghost sm" href="/client/feedback">
          Feedback you&rsquo;ve given
        </Link>
      </div>

      {/* The list reads a recent window of past events (window.ts); older
          ones are a page further back, never silently missing. */}
      {loaded && tab !== 'upcoming' && !reversed && !(empty && olderHref) ? (
        <p className="sm muted mt-16">
          {loaded.until
            ? `Past events from ${dayLabel(loaded.since)} to ${dayLabel(loaded.until)}`
            : `Past events since ${dayLabel(loaded.since)}`}
          {olderHref ? (
            <>
              {' · '}
              <Link href={olderHref} scroll={false}>
                Show older events
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/**
 * The list's tab and filters, kept in the address bar (`listQuery`).
 *
 * React state is what the inputs render from, so typing never waits on a
 * navigation; each change is mirrored into the URL with
 * `history.replaceState`, which Next.js folds into `useSearchParams`
 * without a server round trip or a scroll jump. `router.replace` would
 * re-run this force-dynamic page on the server — four view reads and a
 * batch of photo signatures — once per keystroke. Replace, not push: a
 * filter is not a page, so Back still leaves the list. When the URL
 * changes from outside (the brand link back to a bare `/client`), the
 * state follows it.
 */
function useListState(
  loaded: LoadedHistory | undefined,
  now: string,
): [ListState, (next: ListState) => void, string | null] {
  const params = useSearchParams();
  const router = useRouter();
  const since = params.get('since');
  const fromUrl = useMemo(() => listStateFromParams(params), [params]);
  const [state, setState] = useState<ListState>(fromUrl);
  const written = useRef(listQuery(fromUrl));

  useEffect(() => {
    const query = listQuery(fromUrl);
    if (query === written.current) return;
    written.current = query;
    setState(fromUrl);
  }, [fromUrl]);

  const update = useCallback(
    (next: ListState) => {
      setState(next);
      const query = listQuery(next);
      if (query === written.current) return;
      written.current = query;
      // `since` ("Show older events") rides along, or the next refresh
      // would narrow the window again.
      const full = withSince(query, since);
      const href = `${window.location.pathname}${full ? `?${full}` : ''}`;
      // A date filter that moves the past window needs rows the page has
      // not read: the server reads them (window.ts). Anything else filters
      // what is already here.
      const wanted = pastWindow(new URLSearchParams(full), ukToday(new Date(now)));
      if (loaded && !sameWindow(wanted, loaded)) router.replace(href, { scroll: false });
      else window.history.replaceState(null, '', href);
    },
    [loaded, now, router, since],
  );

  const older =
    loaded?.older && !state.filters.from
      ? `/client?${olderQuery(withSince(listQuery(state), since), loaded)}`
      : null;

  return [state, update, older];
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
  range,
  onSwapDates,
  older,
  searching = false,
}: {
  reason: 'none' | 'tab' | 'filters' | 'range';
  tab: Tab;
  /** How many rows of this tab the filters are hiding. */
  hidden: number;
  onShowAll: () => void;
  onClearFilters: () => void;
  /** The two dates, when "From" is after "To" (`rangeReversed`). */
  range?: { from: string; to: string };
  onSwapDates?: () => void;
  /** Past events exist before the window read (window.ts): where they are. */
  older?: { since: string; href: string };
  /** The search box is in use: older history may hold who they are looking for. */
  searching?: boolean;
}) {
  // The dates contradict each other: say so, and offer the obvious fix,
  // rather than "No events match your filters".
  if (reason === 'range') {
    return (
      <div className="ev-empty">
        <EmptyState>
          <h3>The dates are the wrong way round</h3>
          <p>{range ? reversedRangeText(range.from, range.to) : 'Swap “From” and “To”.'}</p>
          <div className="row wrap mt-16 ev-empty-actions">
            {onSwapDates ? (
              <Button size="sm" onClick={onSwapDates}>
                Swap the dates
              </Button>
            ) : null}
            <Button size="sm" tone="ghost" onClick={onClearFilters}>
              Clear filters
            </Button>
          </div>
        </EmptyState>
      </div>
    );
  }
  // "No events yet" / "no past events yet" would be untrue with history
  // before the window: say what was looked at, and offer the rest.
  if (older && (reason === 'none' || (reason === 'tab' && tab !== 'upcoming'))) {
    return (
      <div className="ev-empty">
        <EmptyState>
          <h3>Nothing recent</h3>
          <p>
            {tab === 'past'
              ? `You have no past events since ${dayLabel(older.since)}.`
              : `You have no upcoming events, and none since ${dayLabel(older.since)}.`}
          </p>
          <Link className="btn sm mt-16" href={older.href} scroll={false}>
            Show older events
          </Link>
        </EmptyState>
      </div>
    );
  }
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
          <div className="row wrap mt-16 ev-empty-actions">
            <Button size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
            {/* "Which events was Priya on?" reaches only the events read
                (ADR-0134 N5): older ones are a page further back. */}
            {searching && older ? (
              <Link className="btn ghost sm" href={older.href} scroll={false}>
                Search older events too
              </Link>
            ) : null}
          </div>
        </EmptyState>
      )}
    </div>
  );
}

/**
 * "On the line-up: Priya Shah" under an event the search found by a worker
 * (ADR-0134 N5), so a row matched on a person says who. Nothing when the
 * search did not match anyone on it.
 */
function StaffMatch({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return <span className="sub ev-match">On the line-up: {names.join(', ')}</span>;
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
        {mine ? <span className="mine"> ({live ? `until ${mine}` : mine} your time)</span> : null}
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
 * "Feedback: 5 to go" (§11.2, ADR-0049). A link to the event page, where the
 * per-worker buttons are; the list itself writes nothing. Short enough for
 * one line in the Status column ("Leave feedback · 5 of 13 to go" folded
 * onto two or three); the accessible name starts with the words on screen
 * (WCAG 2.5.3) and carries the whole of it.
 */
function FeedbackNudge({ eventId, toGo, total }: { eventId: string; toGo: number; total: number }) {
  return (
    <Link
      className="ev-nudge"
      href={`/client/events/${eventId}`}
      aria-label={`Feedback: ${toGo} to go. Leave feedback for ${toGo} of ${total} ${total === 1 ? 'worker' : 'workers'}`}
    >
      {`Feedback: ${toGo} to go`}
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
    <span className="ev-sheet ready">✓ Completed Timesheet ready</span>
  ) : (
    <span className="ev-sheet">Completed Timesheet not issued yet</span>
  );
}

/**
 * The row's document (§11.1, §11.3): a real download (an `<a href>` to the
 * PDF, so it can be saved or forwarded from a phone, §11.4) once the office
 * has issued that kind, filled as the row's primary action (ADR-0049), with
 * a "Preparing…" state while the PDF is fetched (`DocumentLink`); the
 * wireframe's "No document" for a cancelled event.
 *
 * Until the office has issued it there is NO button: a disabled full-width
 * pill on every upcoming card read as a broken primary action. A quiet line
 * says what to expect instead (`documentPendingLine`: the Allocation
 * Timesheet is sent the day before, once every role is confirmed), and
 * "Details →" is the row's way on.
 */
function DocumentButton({
  event,
  offer,
  now,
}: {
  event: PortalEvent;
  offer: ReturnType<typeof documentOffer>;
  now: Date;
}) {
  if (!offer) return <span className="muted sm">No document</span>;
  if (offer.available) {
    return (
      <DocumentLink
        className="btn sm primary"
        href={`/client/events/${event.id}/document?kind=${offer.kind}`}
      >
        {DOC_LABEL[offer.kind]}
      </DocumentLink>
    );
  }
  return (
    <span className="ev-sheet muted doc-pending">
      {documentPendingLine(offer.kind, event, now)}
    </span>
  );
}

/**
 * The faces on a row (§11.1): "photos of the confirmed workers (not
 * initials — so the customer recognises the people by face)". A worker with
 * no selfie yet, or whose photo could not be signed, is a neutral
 * silhouette as the wireframe draws it, never initials; a removed worker
 * keeps their slot with no photo at all, so the headcount is not skewed
 * (§1.7).
 */
function Faces({ people, photos }: { people: LineupRow[]; photos: Record<string, string> }) {
  const shown = people.slice(0, FACES_SHOWN);
  const extra = people.length - shown.length;

  return (
    // The "+N" chip is the group's own, sized and shaped as the faces (`sm`).
    <AvatarGroup more={extra} size="sm" moreLabel={`${extra} more confirmed`}>
      {shown.map((p) => (
        <Avatar
          key={p.bookingId}
          name={p.name}
          size="sm"
          src={photos[p.bookingId]}
          deleted={isRemoved(p)}
          silhouette
        />
      ))}
    </AvatarGroup>
  );
}

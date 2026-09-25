/**
 * Client Portal rules — §11.1, §11.2, §11.5.
 *
 * Pure functions, no Supabase and no React, so the behaviour the two
 * screens turn on can be pinned by tests rather than by clicking. They live
 * in the app rather than in `packages/domain` because nothing outside the
 * portal uses them and CLAUDE.md wants shared-package changes in their own
 * pull request first.
 *
 * The one rule worth stating twice: nothing here computes, formats or
 * rounds money. §11.1 gives the customer no pay rate, no charge rate, no
 * margin and no total, and the views underneath carry no such column, so
 * there is nothing for this file to leak.
 */

import { UK_ZONE, formatDateIn, formatTimeIn, ukToday } from '@thc/domain';

export type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

export type Tab = 'upcoming' | 'past' | 'all';

/** One row of `client_events_v`, plus the counts aggregated from its sections. */
export interface PortalEvent {
  id: string;
  title: string;
  venueName: string;
  venueAddress: string;
  eventDate: string;
  poNumber: string | null;
  onsiteContact: string | null;
  startsAt: string;
  endsAt: string;
  status: EventStatus;
}

/** One row of `client_role_sections_v`. */
export interface RoleSection {
  shiftId: string;
  eventId: string;
  role: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  confirmed: number;
}

/** One row of `client_lineup_v`. */
export interface LineupRow {
  bookingId: string;
  eventId: string;
  role: string;
  startsAt: string;
  endsAt: string;
  name: string;
  photoPath: string | null;
  sortKey: string;
  feedbackGiven: boolean;
}

/**
 * "N of M confirmed" (§11.1).
 *
 * N counts confirmed workers only and M is the headcount the customer
 * booked. The buffer is THC's own over-booking and is never shown here
 * (§3.2), which is why this adds `headcount` and never `headcount + buffer`
 * — `client_role_sections_v` does not return the buffer at all, so the sum
 * cannot accidentally include it.
 */
export function fillOf(sections: readonly RoleSection[]): {
  confirmed: number;
  headcount: number;
  percent: number;
  tone: 'green' | 'amber';
} {
  const confirmed = sections.reduce((n, s) => n + s.confirmed, 0);
  const headcount = sections.reduce((n, s) => n + s.headcount, 0);
  const percent = headcount === 0 ? 0 : Math.min(100, Math.round((confirmed / headcount) * 100));
  return { confirmed, headcount, percent, tone: confirmed >= headcount ? 'green' : 'amber' };
}

/** The two §11.3 PDFs, as `client_event_documents_v` names them. */
export type DocumentKind = 'allocation' | 'signout';

/**
 * Which document the row offers (§11.1, §11.3).
 *
 * The allocation sheet is downloadable before AND during the event — §11.3
 * is explicit that there is "no time restriction on when it can be emailed
 * or downloaded". Once the event is over it becomes the sign-out timesheet.
 * A cancelled event keeps its row, greyed, with no document.
 */
export function documentFor(status: EventStatus): DocumentKind | null {
  if (status === 'cancelled') return null;
  return status === 'completed' ? 'signout' : 'allocation';
}

/** One download the screen draws: live when the office has issued a copy. */
export interface DocumentOffer {
  kind: DocumentKind;
  available: boolean;
}

/**
 * The list's document button (§11.1): the kind `documentFor` names, live
 * only when `client_event_documents_v` holds a copy of it. A cancelled
 * event offers nothing, whatever was issued before the cancellation.
 *
 * `issued` is what the view returned for this event — for the sign-out
 * timesheet that is a FINAL copy only (sent, or drawn after the window
 * ended), so a completed event whose timesheet is still a mid-event draft
 * shows the button disabled rather than a link to a half-filled sheet.
 */
export function documentOffer(
  status: EventStatus,
  issued: readonly DocumentKind[],
): DocumentOffer | null {
  const kind = documentFor(status);
  return kind ? { kind, available: issued.includes(kind) } : null;
}

/**
 * The event page's header downloads (§11.2, wireframes/client/event.html).
 *
 * Before and during the event: "↓ Download Allocation Sheet", live or
 * disabled. Completed: "↓ Download Signed Timesheet" takes the primary slot
 * (live once a final copy exists, disabled until then) and the allocation
 * sheet stays beside it as history — but only when one was issued; there
 * is no sense in a disabled button for a document that will never come.
 * Cancelled: nothing.
 */
export function headerDocuments(
  status: EventStatus,
  issued: readonly DocumentKind[],
): DocumentOffer[] {
  if (status === 'cancelled') return [];
  if (status !== 'completed')
    return [{ kind: 'allocation', available: issued.includes('allocation') }];
  const history: DocumentOffer[] = issued.includes('allocation')
    ? [{ kind: 'allocation', available: true }]
    : [];
  return [...history, { kind: 'signout', available: issued.includes('signout') }];
}

/**
 * The star picker's readout (wireframes/client/event.html: "4 of 5 — tap a
 * star"). Before a choice it says what is wanted; after one, what was
 * chosen — the number is the accessible answer to "which star is on".
 */
export function starsHint(rating: number): string {
  return rating > 0 ? `${rating} of 5 — tap a star` : 'Tap a star — 1 to 5, required';
}

/**
 * Whether "Leave feedback" is live (§11.2).
 *
 * "Feedback only unlocks after the event has started" — the event window's
 * start, which is the earliest role start (§1.5), not the start of the role
 * the worker happens to be on. It stays open after the event completes: the
 * scope sets no closing rule. A cancelled event has no line-up to rate.
 *
 * The screen and `submit_client_feedback()` apply the same test. This one
 * only decides whether a button looks pressable; the RPC is what actually
 * refuses, because a disabled button stops nobody.
 */
export function feedbackOpen(event: Pick<PortalEvent, 'status' | 'startsAt'>, now: Date): boolean {
  if (event.status === 'cancelled') return false;
  return now.getTime() >= new Date(event.startsAt).getTime();
}

/**
 * The line-up as §11.2 shows it: grouped by role, and inside a role ordered
 * the way §11.3 orders the PDF, so the screen and the document list the
 * same people in the same sequence.
 *
 * Role groups follow the role's own start time (RULE-18) — Chef at 07:00
 * before Waiting Staff at 17:00 — and ties break by name so the order is
 * total rather than merely sorted.
 */
export function groupByRole(
  lineup: readonly LineupRow[],
  sections: readonly RoleSection[],
): { role: string; startsAt: string; endsAt: string; confirmed: number; people: LineupRow[] }[] {
  const byRole = new Map<string, LineupRow[]>();
  for (const row of lineup) {
    const list = byRole.get(row.role);
    if (list) list.push(row);
    else byRole.set(row.role, [row]);
  }

  return [...byRole.entries()]
    .map(([role, people]) => {
      // The section carries the role's window; fall back to the booking's
      // own times if a section is missing, so a row is never dropped.
      const section = sections.find((s) => s.role === role);
      const first = people[0];
      return {
        role,
        startsAt: section?.startsAt ?? first?.startsAt ?? '',
        endsAt: section?.endsAt ?? first?.endsAt ?? '',
        confirmed: people.length,
        people: [...people].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.role.localeCompare(b.role));
}

/**
 * The Upcoming / Past / All segmented control (§11.1).
 *
 * "Upcoming" is anything whose window has not yet ended — upcoming AND
 * ongoing. The label was shortened so the three options fit a phone
 * (ADR-0034); the rule was not. So an event running right now stays in the
 * tab the customer is looking at rather than jumping to Past the moment it
 * starts. A cancelled event is
 * neither upcoming nor past work: it is filed by its date like any other
 * row, because §11.1 keeps the row visible rather than hiding it.
 */
export function filterByTab(events: readonly PortalEvent[], tab: Tab, now: Date): PortalEvent[] {
  if (tab === 'all') return [...events];
  const ended = (e: PortalEvent) => new Date(e.endsAt).getTime() < now.getTime();
  return events.filter((e) => (tab === 'past' ? ended(e) : !ended(e)));
}

/** Newest first, as §11.1's list is ordered. */
export function byDateDescending(events: readonly PortalEvent[]): PortalEvent[] {
  return [...events].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

/** The pill tone for a status, matching the wireframe. Completed and
 *  cancelled are both the plain pill. */
export function statusTone(status: EventStatus): 'green' | 'cyan' | 'neutral' {
  if (status === 'ongoing') return 'green';
  if (status === 'upcoming') return 'cyan';
  return 'neutral';
}

/**
 * A worker removed under GDPR (§1.7): the view returns the anonymised name
 * "Deleted account #id" and no photo. They keep their slot on the line-up
 * so the headcount is not skewed, but there is nobody left to rate.
 */
export function isRemoved(row: Pick<LineupRow, 'name'>): boolean {
  return row.name.startsWith('Deleted account');
}

/** One role's share of "N of M confirmed", for the list's breakdown line. */
export interface RoleFill {
  role: string;
  confirmed: number;
  headcount: number;
  /** Fewer confirmed than booked: drawn in the amber the bar uses. */
  short: boolean;
}

/**
 * "Waiting 8/10 · Bar 5/7" under the list's fill bar (§11.1, ADR-0034).
 *
 * The same numbers `fillOf` adds up, split by role: confirmed only against
 * the booked headcount, never the buffer (§3.2). Two sections of the same
 * role (a lunch and a dinner shift of Waiting Staff) are one entry, because
 * the customer booked "Waiting Staff", not two shift ids. Ordered by the
 * role's own start (RULE-18) as the event page groups them, so the line and
 * the page read in the same order.
 */
export function roleBreakdown(sections: readonly RoleSection[]): RoleFill[] {
  const byRole = new Map<string, { startsAt: string; confirmed: number; headcount: number }>();
  for (const s of sections) {
    const seen = byRole.get(s.role);
    if (seen) {
      seen.confirmed += s.confirmed;
      seen.headcount += s.headcount;
      if (s.startsAt < seen.startsAt) seen.startsAt = s.startsAt;
    } else {
      byRole.set(s.role, { startsAt: s.startsAt, confirmed: s.confirmed, headcount: s.headcount });
    }
  }
  return [...byRole.entries()]
    .sort(([ra, a], [rb, b]) => a.startsAt.localeCompare(b.startsAt) || ra.localeCompare(rb))
    .map(([role, f]) => ({
      role,
      confirmed: f.confirmed,
      headcount: f.headcount,
      short: f.confirmed < f.headcount,
    }));
}

/**
 * "Leave feedback · 5 of 13 to go" on a list row (§11.2, ADR-0034).
 *
 * Only once the event has started (the same `feedbackOpen` test the event
 * page's buttons use) and only for an ongoing or completed event, so an
 * upcoming row never carries the nudge even if the clock and the view's
 * status briefly disagree. A removed worker cannot be rated (the event
 * page disables their button), so they count on neither side. Null when
 * there is nothing to nudge about: not started, cancelled, nobody to rate,
 * or every rateable worker already has the customer's feedback.
 */
export function feedbackToGo(
  event: Pick<PortalEvent, 'id' | 'status' | 'startsAt'>,
  lineup: readonly LineupRow[],
  now: Date,
): { toGo: number; total: number } | null {
  if (event.status !== 'ongoing' && event.status !== 'completed') return null;
  if (!feedbackOpen(event, now)) return null;
  const rateable = lineup.filter((l) => l.eventId === event.id && !isRemoved(l));
  const toGo = rateable.filter((l) => !l.feedbackGiven).length;
  return toGo === 0 ? null : { toGo, total: rateable.length };
}

/**
 * Whether a completed event's signed timesheet is out yet (§11.3, ADR-0034).
 *
 * Read straight off `documentOffer`, so the words and the button cannot
 * disagree: "ready" exactly when the button is a live download. An event
 * that is not completed has no timesheet to wait for.
 */
export function timesheetStatus(
  status: EventStatus,
  issued: readonly DocumentKind[],
): 'ready' | 'pending' | null {
  if (status !== 'completed') return null;
  const offer = documentOffer(status, issued);
  if (!offer || offer.kind !== 'signout') return null;
  return offer.available ? 'ready' : 'pending';
}

/**
 * The list's filters, on top of the tab (ADR-0034). Dates are `yyyy-mm-dd`
 * as an `<input type="date">` gives them, read as UK calendar days; an
 * empty string means "no bound".
 */
export interface EventFilters {
  query: string;
  venue: string;
  from: string;
  to: string;
}

export const NO_FILTERS: EventFilters = { query: '', venue: '', from: '', to: '' };

/** True when any filter is narrowing the list: what "Clear filters" undoes. */
export function filtersActive(f: EventFilters): boolean {
  return f.query.trim() !== '' || f.venue !== '' || f.from !== '' || f.to !== '';
}

/** The venue select's options: each venue once, A to Z. */
export function venuesOf(events: readonly PortalEvent[]): string[] {
  return [...new Set(events.map((e) => e.venueName))].sort((a, b) => a.localeCompare(b));
}

/**
 * The search, venue and date range, combined (ADR-0034).
 *
 * The day an event is filed under is the UK calendar day it starts on, the
 * day the list's Date column prints (`ukDateShort`), evaluated in
 * Europe/London (§1.8) rather than as the UTC date of the timestamp. So an
 * event at 23:30 UK on the "To" day is in, and one at 00:30 UK the day
 * after is out, although in summer that is still the "To" day in UTC. Both
 * bounds are inclusive. A "From" after the "To" matches nothing rather
 * than being silently swapped; the empty state then names the filters as
 * the reason.
 */
export function applyFilters(events: readonly PortalEvent[], f: EventFilters): PortalEvent[] {
  const needle = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (
      needle !== '' &&
      !e.title.toLowerCase().includes(needle) &&
      !e.venueName.toLowerCase().includes(needle) &&
      !(e.poNumber ?? '').toLowerCase().includes(needle)
    )
      return false;
    if (f.venue !== '' && e.venueName !== f.venue) return false;
    if (f.from === '' && f.to === '') return true;
    const day = ukToday(new Date(e.startsAt));
    if (f.from !== '' && day < f.from) return false;
    if (f.to !== '' && day > f.to) return false;
    return true;
  });
}

/**
 * Why the list is empty, so the empty state can say so (ADR-0034): the
 * customer has no events at all; the tab has none (so clearing the filters
 * would not help); or the tab has some and the search and filters hid them
 * all. Null when there are rows to show.
 */
export function emptyReason(
  total: number,
  inTab: number,
  shown: number,
): 'none' | 'tab' | 'filters' | null {
  if (shown > 0) return null;
  if (total === 0) return 'none';
  if (inTab === 0) return 'tab';
  return 'filters';
}

/**
 * The "Next up" strip above the list (ADR-0034).
 *
 * An event running now wins ("Happening now"), the earliest-started first
 * if several overlap; otherwise the soonest upcoming one. Cancelled and
 * completed events never appear, and nothing is returned when there is
 * nothing ahead. Status is the view's own `event_status()`, the same word
 * the row's pill prints, so the strip and the list cannot disagree.
 */
export function nextUp(
  events: readonly PortalEvent[],
  now: Date,
): { event: PortalEvent; live: boolean; when: string } | null {
  const soonest = (status: EventStatus) =>
    events
      .filter((e) => e.status === status)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))[0];

  const live = soonest('ongoing');
  if (live) return { event: live, live: true, when: `until ${ukMoment(live.endsAt, now, true)}` };
  const next = soonest('upcoming');
  return next ? { event: next, live: false, when: ukMoment(next.startsAt, now, false) } : null;
}

/**
 * "today 07:00 UK", "tomorrow 07:00 UK", "Thu 1 Oct 07:00 UK": a scheduled
 * time in UK time with the " UK" suffix (§1.8). The strip is a one-line
 * pointer into the event, whose page carries the full dual-zone window.
 * "Today" is judged on the UK calendar, like every rule. With `dropToday`
 * the day is left off when it is today ("until 23:30 UK").
 */
function ukMoment(iso: string, now: Date, dropToday: boolean): string {
  const at = new Date(iso);
  const day = ukToday(at);
  const today = ukToday(now);
  const time = `${formatTimeIn(at, UK_ZONE)} UK`;
  if (day === today) return dropToday ? time : `today ${time}`;
  if (day === nextDay(today)) return `tomorrow ${time}`;
  const year = day.slice(0, 4) !== today.slice(0, 4);
  return `${formatDateIn(at, UK_ZONE, { weekday: 'short', year })} ${time}`;
}

/** The calendar day after a `yyyy-mm-dd`, with no clock involved. */
function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

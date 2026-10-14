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
import { daysBetweenIn } from './format';

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
  /** When the event was cancelled (ISO), for "cancelled 16 Sep"; null otherwise. */
  cancelledAt?: string | null;
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
  /**
   * The section's dress code, as the office picked it from the client's own
   * rate card (ADR-0134 N2); read on the event page only, null when none.
   */
  dressCode?: string | null;
}

/**
 * One row of `client_lineup_v`, as the browser receives it.
 *
 * Without the view's `photo_path` as a field: the server reads it into
 * `LineupRecord` (data.ts), signs the photo, and hands over the signed URL
 * keyed by `bookingId` (photos.ts `presentLineup`). That keeps the screens'
 * props to what they render; it does not hide the path. A signed URL carries
 * it (`…/sign/photos/<staff_id>/<file>?token=…`), so the worker's `staff.id`
 * does reach the browser inside each photo URL — an opaque id that opens
 * nothing without the token, which ADR-0026 §4 accepts as harmless.
 */
export interface LineupRow {
  bookingId: string;
  eventId: string;
  /** The role section (`shift_requirements.id`) the booking is on. */
  shiftId: string | null;
  role: string;
  startsAt: string;
  endsAt: string;
  name: string;
  sortKey: string;
  feedbackGiven: boolean;
  /** The stars the customer gave (1–5), once they have; null before. */
  feedbackRating?: number | null;
  /** When the customer's feedback was sent (ISO); null before. */
  feedbackSentAt?: string | null;
}

/** Faces drawn per row of the event list (§11.1); the rest are a "+N" chip. */
export const FACES_SHOWN = 6;

/**
 * The line-up rows whose faces the event list actually draws: per event that
 * is not cancelled, the first `FACES_SHOWN` in the order the row lists them
 * (`sortKey`, as `EventsScreen` sorts). Only these photos are signed for the
 * list (photos.ts); the event page signs its whole line-up.
 */
export function listFaces<T extends Pick<LineupRow, 'eventId' | 'sortKey'>>(
  events: readonly Pick<PortalEvent, 'id' | 'status'>[],
  lineup: readonly T[],
): T[] {
  const drawn = new Set(events.filter((e) => e.status !== 'cancelled').map((e) => e.id));
  const byEvent = new Map<string, T[]>();
  for (const row of lineup) {
    if (!drawn.has(row.eventId)) continue;
    const list = byEvent.get(row.eventId);
    if (list) list.push(row);
    else byEvent.set(row.eventId, [row]);
  }
  return [...byEvent.values()].flatMap((rows) =>
    [...rows].sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(0, FACES_SHOWN),
  );
}

/**
 * One section's share of "N of M confirmed": its confirmed workers, never
 * more than the headcount booked.
 *
 * Six confirmed on a Waiting Staff section of four is THC's buffer at work;
 * the customer booked four, and the two extra are THC's insurance and stay
 * internal (§3.2, the wireframe: "N counts confirmed workers only … buffer
 * slots are internal and never shown"). Since 20261014140000 (ADR-0134)
 * `client_role_sections_v.confirmed` is already held to the headcount and
 * `client_lineup_v` returns at most that many people per section, so the
 * buffer never reaches the browser; this cap stays as the second guard
 * (a portal deployed ahead of the migration, a test fixture), and it is a
 * no-op on what the views now return. An over-filled section can never
 * make up for an empty one.
 */
export function cappedConfirmed(section: Pick<RoleSection, 'confirmed' | 'headcount'>): number {
  return Math.max(0, Math.min(section.confirmed, section.headcount));
}

/**
 * "N of M confirmed" (§11.1).
 *
 * M is the headcount the customer booked; N is the sum of each section's
 * `cappedConfirmed`, so Host 2/2 + Waiting Staff 6/4 + Bar Staff 0/2 is
 * "6 of 8", not "8 of 8". Green only when EVERY section is full — a total
 * that happens to reach M while one role is empty is still amber — and the
 * bar is drawn from the capped sum. `client_role_sections_v` does not
 * return the buffer itself, and nothing here adds it.
 */
export function fillOf(sections: readonly RoleSection[]): {
  confirmed: number;
  headcount: number;
  percent: number;
  tone: 'green' | 'amber';
} {
  const confirmed = sections.reduce((n, s) => n + cappedConfirmed(s), 0);
  const headcount = sections.reduce((n, s) => n + Math.max(0, s.headcount), 0);
  const percent = headcount === 0 ? 0 : Math.min(100, Math.round((confirmed / headcount) * 100));
  const full = sections.every((s) => s.confirmed >= s.headcount);
  return { confirmed, headcount, percent, tone: full ? 'green' : 'amber' };
}

/**
 * "N of M arrived" (ADR-0053) on the same footing as "N of M confirmed".
 *
 * A section of four with six confirmed once read "5 of 6 arrived" — THC's
 * over-booking again. Each section is held to its headcount (from
 * `client_role_sections_v`): at most that many confirmed, and at most that
 * many arrived (under the strict buffer policy only the first `headcount`
 * check-ins work, RULE-15). Since 20261014140000 (ADR-0134)
 * `client_arrivals_v` applies the same cap itself — the checked-in take the
 * line-up's seats first, so its `arrived` is the arrivals among the faces
 * shown — and this is the second guard. The event's total is re-added from
 * the capped sections. A section the sections read did not return keeps
 * its own figures.
 */
export function arrivalsWithinHeadcount<
  T extends {
    confirmed: number;
    arrived: number;
    bySection: Record<string, { confirmed: number; arrived: number }>;
  },
>(counts: T | undefined, sections: readonly RoleSection[]): T | undefined {
  // No per-section figures to hold to anything: leave the totals alone.
  if (!counts || Object.keys(counts.bySection).length === 0) return counts;
  const headcount = new Map(sections.map((s) => [s.shiftId, s.headcount]));
  const bySection: Record<string, { confirmed: number; arrived: number }> = {};
  let confirmed = 0;
  let arrived = 0;
  for (const [id, figure] of Object.entries(counts.bySection)) {
    const cap = headcount.get(id);
    const c = cap === undefined ? figure.confirmed : Math.min(figure.confirmed, Math.max(0, cap));
    const a = Math.min(figure.arrived, c);
    bySection[id] = { confirmed: c, arrived: a };
    confirmed += c;
    arrived += a;
  }
  return { ...counts, confirmed, arrived, bySection };
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
 * Before and during the event: "↓ Download Allocation Timesheet", live or
 * disabled. Completed: "↓ Download Completed Timesheet" takes the primary slot
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
 * Device-neutral: the stars are chosen by mouse, finger or arrow keys, so
 * the copy says "choose", never "tap".
 */
export function starsHint(rating: number): string {
  return rating > 0 ? `${rating} of 5 stars` : 'Choose 1 to 5 stars — required';
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
 * The line-up as §11.2 shows it: one group per role SECTION, and inside a
 * section ordered the way §11.3 orders the PDF, so the screen and the
 * document list the same people in the same sequence.
 *
 * A section is a `shift_requirements` row, keyed by its `shift_id`. Two
 * sections of one role (Waiting Staff 07:00–15:00 and Waiting Staff
 * 17:00–23:30) are two groups with two windows, exactly as the PDF keys
 * them (`packages/pdf/src/sheet.ts` `sectionKey`); grouping by role name
 * merged them under the first section's window. A row without a shift id
 * falls back to role + window, which is the PDF's own fallback.
 *
 * Groups follow the section's own start time (RULE-18), so Chef at 07:00
 * comes before Waiting Staff at 17:00, and ties break by role name and
 * then by key so the order is total rather than merely sorted.
 *
 * Every section the customer booked is a group, including one nobody has
 * confirmed on yet (`people` empty, `confirmed` 0): an upcoming event with
 * no confirmations still shows its roles and their windows, each saying so,
 * rather than a header over nothing.
 */
export interface LineupGroup {
  /** The shift id, or role + window when the row carries none. */
  key: string;
  role: string;
  startsAt: string;
  endsAt: string;
  confirmed: number;
  /** The headcount booked for the section; null for a row with no section. */
  headcount: number | null;
  /** The section's dress code (ADR-0134 N2); null when none or not read. */
  dressCode: string | null;
  people: LineupRow[];
}

function sectionKey(row: Pick<LineupRow, 'shiftId' | 'role' | 'startsAt' | 'endsAt'>): string {
  return row.shiftId ?? `${row.role}|${row.startsAt}|${row.endsAt}`;
}

export function groupBySection(
  lineup: readonly LineupRow[],
  sections: readonly RoleSection[],
): LineupGroup[] {
  const bySection = new Map<string, LineupRow[]>();
  for (const row of lineup) {
    const key = sectionKey(row);
    const list = bySection.get(key);
    if (list) list.push(row);
    else bySection.set(key, [row]);
  }

  // Sections with nobody on them yet, so the page still lists the role.
  for (const s of sections) if (!bySection.has(s.shiftId)) bySection.set(s.shiftId, []);

  return [...bySection.entries()]
    .map(([key, people]) => {
      // The section carries the role's window; fall back to the booking's
      // own times if a section is missing, so a row is never dropped. A
      // group with no people came from a section, so one of the two exists.
      const section = sections.find((s) => s.shiftId === key);
      const from = (section ?? people[0])!;
      return {
        key,
        role: from.role,
        startsAt: from.startsAt,
        endsAt: from.endsAt,
        confirmed: people.length,
        headcount: section ? section.headcount : null,
        dressCode: section?.dressCode?.trim() || null,
        people: [...people].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
      };
    })
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) ||
        a.role.localeCompare(b.role) ||
        a.key.localeCompare(b.key),
    );
}

/**
 * The tone of a role section's "N confirmed" pill on the event page: the
 * list's own rule (`fillOf`, `roleBreakdown`'s `short`) — green only once
 * the section is full, amber while it is short — so "0 confirmed" is never
 * green. A section with no headcount to compare (a booking whose section is
 * missing) is green when someone is on it and amber when nobody is. Once
 * the event is over the pill counts who worked, a fact rather than a gap,
 * and is neutral.
 */
export function sectionTone(
  group: Pick<LineupGroup, 'confirmed' | 'headcount'>,
  completed: boolean,
): 'green' | 'amber' | 'neutral' {
  if (completed) return 'neutral';
  if (group.confirmed === 0) return 'amber';
  if (group.headcount === null) return 'green';
  return group.confirmed >= group.headcount ? 'green' : 'amber';
}

/**
 * The words on a role section's pill: "4 of 4 confirmed" (or "worked" once
 * the event is over), the confirmed count held to the headcount
 * (`cappedConfirmed`) so a section carrying THC's buffer never reads "6 of
 * 4". The line-up under it is held to the headcount too, in the view
 * (ADR-0134); the one exception is a worker the customer has already rated,
 * who stays visible past the headcount — and the pill still reads the
 * booking, "4 of 4". A row with no section (no headcount to compare) says
 * what it has: "2 confirmed".
 */
export function sectionCountLabel(
  group: Pick<LineupGroup, 'confirmed' | 'headcount'>,
  completed: boolean,
): string {
  const word = completed ? 'worked' : 'confirmed';
  if (group.headcount === null) return `${group.confirmed} ${word}`;
  const n = cappedConfirmed({ confirmed: group.confirmed, headcount: group.headcount });
  return `${n} of ${group.headcount} ${word}`;
}

/**
 * "3 roles" in the event header: the distinct roles the customer booked,
 * read from the role sections — two sections of one role are one role —
 * so an event with nobody confirmed yet still counts its roles. The
 * line-up is the fallback only when no section came back.
 */
export function roleCountOf(
  sections: readonly Pick<RoleSection, 'role'>[],
  lineup: readonly Pick<LineupRow, 'role'>[],
): number {
  const from = sections.length > 0 ? sections : lineup;
  return new Set(from.map((s) => s.role)).size;
}

/**
 * The list panel's title (wireframes/client/events.html: "Events · Leonardo
 * Hotel St Pauls"). Plain "Events" when the company could not be read.
 */
export function eventsPanelTitle(company: string | null | undefined): string {
  const name = company?.trim();
  return name ? `Events · ${name}` : 'Events';
}

/**
 * The longest comment a customer may leave (§11.5). The textarea stops at
 * it, the server action refuses past it before the RPC, and
 * `submit_client_feedback()` refuses past it again — the last is the one
 * that holds, the first two only spare the customer a round trip.
 */
export const FEEDBACK_TEXT_MAX = 2000;

export const FEEDBACK_TOO_LONG = `Keep the comment to ${FEEDBACK_TEXT_MAX.toLocaleString('en-GB')} characters or fewer.`;

/**
 * What the customer reads when their session lapsed before the feedback was
 * sent: the server action found no session, or its request was turned away
 * to /login before it ran (FeedbackModal `sessionLapsed`). The modal keeps
 * the typed comment, so signing in again loses nothing.
 */
export const FEEDBACK_SIGNED_OUT = "You've been signed out — sign in again to send this feedback.";

/**
 * A comment is fine at or under the limit; it is measured after trimming,
 * in code points as Postgres's char_length counts them (an emoji is one).
 */
export function feedbackTextTooLong(text: string): boolean {
  return [...text.trim()].length > FEEDBACK_TEXT_MAX;
}

/**
 * The customer's sentence for a refused `submit_client_feedback()` (§11.5).
 *
 * The RPC raises SQLSTATE 22023 for two different things: a rating outside
 * 1–5 ("Rating must be between 1 and 5") and an event that has not started
 * ("Feedback opens once the event has started"). Keyed on the code alone,
 * a bad rating read as "not started yet", so the message decides which.
 *
 * A comment over the limit may come back as 22023 ("… too long" / "… 2000
 * characters"), 22001 (string_data_right_truncation) or 23514 (a check
 * constraint on the column); all three read as the length sentence. Nothing
 * here ever returns the database's own message.
 */
export function feedbackErrorMessage(error: {
  code?: string | null;
  message?: string | null;
}): string {
  const message = (error.message ?? '').toLowerCase();
  switch (error.code) {
    case '22023':
      if (message.includes('rating')) return 'Choose a rating between 1 and 5 stars.';
      if (message.includes('started')) return 'Feedback opens once the event has started.';
      if (mentionsLength(message)) return FEEDBACK_TOO_LONG;
      return 'That could not be saved.';
    case '22001':
      return FEEDBACK_TOO_LONG;
    case '23514':
      return mentionsLength(message) || message.includes('text')
        ? FEEDBACK_TOO_LONG
        : 'That could not be saved.';
    case '23505':
      return 'Feedback has already been left for this person on this event.';
    case '42501':
      return 'That booking is not on one of your events.';
    default:
      return 'That could not be saved.';
  }
}

function mentionsLength(message: string): boolean {
  return (
    message.includes('long') ||
    message.includes('length') ||
    message.includes('characters') ||
    message.includes(String(FEEDBACK_TEXT_MAX))
  );
}

/**
 * The Upcoming / Past / All segmented control (§11.1).
 *
 * "Upcoming" is anything whose window has not yet ended — upcoming AND
 * ongoing. The label was shortened so the three options fit a phone
 * (ADR-0049); the rule was not. So an event running right now stays in the
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

/** Newest first, as §11.1's list is ordered on Past and All. */
export function byDateDescending(events: readonly PortalEvent[]): PortalEvent[] {
  return [...events].sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}

/** Soonest first: what is coming up reads in the order it happens. */
export function byDateAscending(events: readonly PortalEvent[]): PortalEvent[] {
  return [...events].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title),
  );
}

/**
 * The order a tab lists in. Upcoming reads soonest first, so tonight's
 * event is the first row rather than the last (product owner, 12.10.2026);
 * Past and All stay newest first, as §11.1's list was ordered.
 */
export function sortForTab(events: readonly PortalEvent[], tab: Tab): PortalEvent[] {
  return tab === 'upcoming' ? byDateAscending(events) : byDateDescending(events);
}

/** The panel title's note on the order, matching `sortForTab`. */
export function orderLabel(tab: Tab): string {
  return tab === 'upcoming' ? 'soonest first' : 'newest first';
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
 * "Waiting 8/10 · Bar 5/7" under the list's fill bar (§11.1, ADR-0049).
 *
 * The same numbers `fillOf` adds up, split by role: each section's confirmed
 * held to its headcount (`cappedConfirmed`), never the buffer (§3.2) — so a
 * Waiting Staff section of four with six confirmed reads "4/4", not "6/4".
 * Two sections of the same role (a lunch and a dinner shift of Waiting
 * Staff) are one entry, because the customer booked "Waiting Staff", not
 * two shift ids; the entry is short when either section is, so a full lunch
 * cannot hide an empty dinner. Ordered by the role's own start (RULE-18) as
 * the event page groups them, so the line and the page read in the same
 * order.
 */
export function roleBreakdown(sections: readonly RoleSection[]): RoleFill[] {
  const byRole = new Map<
    string,
    { startsAt: string; confirmed: number; headcount: number; short: boolean }
  >();
  for (const s of sections) {
    const short = s.confirmed < s.headcount;
    const seen = byRole.get(s.role);
    if (seen) {
      seen.confirmed += cappedConfirmed(s);
      seen.headcount += Math.max(0, s.headcount);
      seen.short ||= short;
      if (s.startsAt < seen.startsAt) seen.startsAt = s.startsAt;
    } else {
      byRole.set(s.role, {
        startsAt: s.startsAt,
        confirmed: cappedConfirmed(s),
        headcount: Math.max(0, s.headcount),
        short,
      });
    }
  }
  return [...byRole.entries()]
    .sort(([ra, a], [rb, b]) => a.startsAt.localeCompare(b.startsAt) || ra.localeCompare(rb))
    .map(([role, f]) => ({
      role,
      confirmed: f.confirmed,
      headcount: f.headcount,
      short: f.short,
    }));
}

/**
 * "Leave feedback · 5 of 13 to go" on a list row (§11.2, ADR-0049).
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
 * Whether the event page still shows "The event has started — you can now
 * leave feedback" (§11.2). It is an invitation, so it goes once there is
 * nothing left to invite: every rateable worker on the line-up already has
 * the customer's feedback (or there is nobody rateable on it at all), or
 * the event ended more than a week ago (the
 * buttons stay live — the scope sets no closing rule — but a banner on an
 * old event is noise). Before the start, the locked-banner says when.
 */
export const FEEDBACK_BANNER_DAYS = 7;

export function feedbackInviteShown(
  event: Pick<PortalEvent, 'status' | 'startsAt' | 'endsAt'>,
  lineup: readonly Pick<LineupRow, 'name' | 'feedbackGiven'>[],
  now: Date,
): boolean {
  if (!feedbackOpen(event, now)) return false;
  const rateable = lineup.filter((l) => !isRemoved(l));
  // Nobody to rate: no banner about buttons that are not on the page.
  if (rateable.length === 0 || rateable.every((l) => l.feedbackGiven)) return false;
  const stale = new Date(event.endsAt).getTime() + FEEDBACK_BANNER_DAYS * 86_400_000;
  return now.getTime() <= stale;
}

/** Whether the event's window is over: completed, or past its end on the clock. */
export function eventEnded(event: Pick<PortalEvent, 'status' | 'endsAt'>, now: Date): boolean {
  return event.status === 'completed' || now.getTime() >= new Date(event.endsAt).getTime();
}

/**
 * The words of the feedback invitation (`feedbackInviteShown` decides
 * whether it shows). While the event runs it says it has started
 * (wireframes/client/event.html:148); once it is over "has started" is
 * stale news, so it says the event has finished and that the ones not yet
 * rated are still open — the buttons stay live with no closing rule.
 */
export function feedbackInviteText(
  event: Pick<PortalEvent, 'status' | 'endsAt'>,
  now: Date,
): string {
  return eventEnded(event, now)
    ? "This event has finished — you can leave feedback for anyone you haven't yet. One entry per person per event."
    : 'The event has started — you can now leave feedback on each member of staff. One entry per person per event.';
}

/**
 * The counts on the Upcoming and Past tabs: the live events in each.
 *
 * A cancelled event is still LISTED in its tab, greyed (§11.1), but it is
 * not an event to attend or one that happened, so "Upcoming 4" with one of
 * the four cancelled over-promised. The rows and the "N events" pill are
 * unchanged; only the badge leaves cancellations out.
 */
export function tabCounts(
  events: readonly PortalEvent[],
  now: Date,
): { upcoming: number; past: number } {
  const live = events.filter((e) => e.status !== 'cancelled');
  return {
    upcoming: filterByTab(live, 'upcoming', now).length,
    past: filterByTab(live, 'past', now).length,
  };
}

/**
 * The quiet line a row shows instead of a dead download button (§11.3,
 * ADR-0074 as amended by ADR-0088), when the office has not issued the
 * document it would offer.
 *
 * The Allocation Timesheet goes out automatically the day before the event
 * once every role is fully confirmed (ADR-0088 §2 — the hour is an office
 * setting, so it is not promised here). That is only worth saying while the
 * day before is still ahead or today; on the day itself, or once the event
 * is running, it plainly has not gone, so the line says only that. The
 * Completed Timesheet is drawn after the event and its timing depends on
 * every check-out being settled (ADR-0074 D2), so it says not yet, nothing
 * more. A cancelled event has its own "No document".
 */
export function documentPendingLine(
  kind: DocumentKind,
  event: Pick<PortalEvent, 'status' | 'startsAt'>,
  now: Date,
): string {
  if (kind === 'signout') return 'Completed Timesheet not issued yet';
  const before = event.status === 'upcoming' && ukToday(new Date(event.startsAt)) > ukToday(now);
  return before
    ? 'Allocation Timesheet: sent the day before, once every role is confirmed'
    : 'Allocation Timesheet not issued yet';
}

/**
 * Whether a completed event's signed timesheet is out yet (§11.3, ADR-0049).
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
 * The list's filters, on top of the tab (ADR-0049). Dates are `yyyy-mm-dd`
 * (the address bar's form; the field itself is typed dd/mm/yyyy,
 * `UkDateField`), read as UK calendar days; an empty string means "no
 * bound".
 */
export interface EventFilters {
  query: string;
  venue: string;
  from: string;
  to: string;
}

export const NO_FILTERS: EventFilters = { query: '', venue: '', from: '', to: '' };

/** The list's tab and filters, as they ride in the address bar. */
export interface ListState {
  tab: Tab;
  filters: EventFilters;
}

const TABS: readonly Tab[] = ['upcoming', 'past', 'all'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads `?tab=past&q=gala&venue=…&from=2026-09-01&to=2026-09-30` back into
 * the list's state, so Back and a reload land on the view the customer
 * left. Anything unreadable is the default: an unknown tab is Upcoming and
 * a date that is not `yyyy-mm-dd` is no bound, so a hand-edited address can
 * narrow the list but never break it.
 */
export function listStateFromParams(params: { get(name: string): string | null }): ListState {
  const tab = params.get('tab');
  const day = (name: string) => {
    const v = params.get(name) ?? '';
    return DAY.test(v) ? v : '';
  };
  return {
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'upcoming',
    filters: {
      query: params.get('q') ?? '',
      venue: params.get('venue') ?? '',
      from: day('from'),
      to: day('to'),
    },
  };
}

/**
 * The query string for a list state, defaults left out: the plain list is
 * plain `/client`, and only what differs from it is written.
 */
export function listQuery({ tab, filters }: ListState): string {
  const q = new URLSearchParams();
  if (tab !== 'upcoming') q.set('tab', tab);
  if (filters.query !== '') q.set('q', filters.query);
  if (filters.venue !== '') q.set('venue', filters.venue);
  if (filters.from !== '') q.set('from', filters.from);
  if (filters.to !== '') q.set('to', filters.to);
  return q.toString();
}

/** True when any filter is narrowing the list: what "Clear filters" undoes. */
export function filtersActive(f: EventFilters): boolean {
  return f.query.trim() !== '' || f.venue !== '' || f.from !== '' || f.to !== '';
}

/** The venue select's options: each venue once, A to Z. */
export function venuesOf(events: readonly PortalEvent[]): string[] {
  return [...new Set(events.map((e) => e.venueName))].sort((a, b) => a.localeCompare(b));
}

/**
 * "PO 4431", "PO4431", "po: 4431", "PO-4431" → "4431": the reference after
 * a "PO" prefix, so a customer can type the PO as the row prints it ("PO
 * 4431") or as their own system writes it. Only a prefix followed by a
 * separator or a digit counts, so "polo" is still a search for "polo".
 */
const PO_PREFIX = /^po(?:[\s#:.-]+|(?=\d))(.+)$/;

/**
 * Whether the list's search box matches an event: the name, the venue and
 * its address, or the PO with or without its "PO " prefix. `needle` is
 * already trimmed and lower-cased.
 */
function searchMatches(e: PortalEvent, needle: string): boolean {
  const po = (e.poNumber ?? '').toLowerCase();
  const bare = PO_PREFIX.exec(needle)?.[1]?.trim();
  return (
    e.title.toLowerCase().includes(needle) ||
    e.venueName.toLowerCase().includes(needle) ||
    e.venueAddress.toLowerCase().includes(needle) ||
    (po !== '' && (po.includes(needle) || (!!bare && po.includes(bare))))
  );
}

/**
 * The search, venue and date range, combined (ADR-0049).
 *
 * The day an event is filed under is the UK calendar day it starts on, the
 * day the list's Date column prints (`ukDateShort`), evaluated in
 * Europe/London (§1.8) rather than as the UTC date of the timestamp. So an
 * event at 23:30 UK on the "To" day is in, and one at 00:30 UK the day
 * after is out, although in summer that is still the "To" day in UTC. Both
 * bounds are inclusive. A "From" after the "To" matches nothing rather
 * than being silently swapped; the empty state then says the dates are the
 * wrong way round (`rangeReversed`, `emptyReason` 'range').
 */
export function applyFilters(events: readonly PortalEvent[], f: EventFilters): PortalEvent[] {
  const needle = f.query.trim().toLowerCase();
  return events.filter((e) => {
    if (needle !== '' && !searchMatches(e, needle)) return false;
    if (f.venue !== '' && e.venueName !== f.venue) return false;
    if (f.from === '' && f.to === '') return true;
    const day = ukToday(new Date(e.startsAt));
    if (f.from !== '' && day < f.from) return false;
    if (f.to !== '' && day > f.to) return false;
    return true;
  });
}

/**
 * Why the list is empty, so the empty state can say so (ADR-0049): the
 * customer has no events at all; the tab has none (so clearing the filters
 * would not help); or the tab has some and the search and filters hid them
 * all. Null when there are rows to show.
 */
export function emptyReason(
  total: number,
  inTab: number,
  shown: number,
  reversed = false,
): 'none' | 'tab' | 'filters' | 'range' | null {
  if (shown > 0) return null;
  // The dates contradict each other: no clearing of the other filters would
  // help, and "no events match" would send the customer looking for one.
  if (reversed) return 'range';
  if (total === 0) return 'none';
  if (inTab === 0) return 'tab';
  return 'filters';
}

/** "From" falls after "To": a range that can match nothing (`applyFilters`). */
export function rangeReversed(f: Pick<EventFilters, 'from' | 'to'>): boolean {
  return f.from !== '' && f.to !== '' && f.from > f.to;
}

/**
 * The "Next up" strip above the list (ADR-0049).
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
): { event: PortalEvent; live: boolean; when: string; at: string; dropToday: boolean } | null {
  const soonest = (status: EventStatus) =>
    events
      .filter((e) => e.status === status)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))[0];

  const live = soonest('ongoing');
  if (live) {
    return {
      event: live,
      live: true,
      when: `until ${momentIn(live.endsAt, now, true, UK_ZONE)} UK time`,
      at: live.endsAt,
      dropToday: true,
    };
  }
  const next = soonest('upcoming');
  return next
    ? {
        event: next,
        live: false,
        when: `${momentIn(next.startsAt, now, false, UK_ZONE)} UK time`,
        at: next.startsAt,
        dropToday: false,
      }
    : null;
}

/**
 * "today 07:00", "tomorrow 07:00", "Thu 1 Oct 07:00": a scheduled time on
 * the wall clock and calendar of `zone`. The strip writes it twice, as §1.8
 * requires of every scheduled time: in UK time (`nextUp().when`, safe on the
 * server) and, once mounted, in the viewer's own zone when that differs
 * ("your time"). "Today" is judged on that zone's own calendar, so a reader
 * in Dubai at 01:00 sees their today, not London's. With `dropToday` the day
 * is left off when it is today ("until 23:30").
 */
export function momentIn(iso: string, now: Date, dropToday: boolean, zone: string): string {
  const at = new Date(iso);
  const time = formatTimeIn(at, zone);
  // Signed: a start on an earlier day is "yesterday" or a date, never
  // "today" (the old clamp at 0 called yesterday's 23:00 "today 23:00").
  const ahead = daysBetweenIn(now, at, zone);
  if (ahead === 0) return dropToday ? time : `today ${time}`;
  if (ahead === 1) return `tomorrow ${time}`;
  if (ahead === -1) return `yesterday ${time}`;
  const year = dayOf(at, zone).slice(0, 4) !== dayOf(now, zone).slice(0, 4);
  return `${formatDateIn(at, zone, { weekday: 'short', year })} ${time}`;
}

/** `yyyy-mm-dd` of `instant` on `zone`'s calendar. */
function dayOf(instant: Date, zone: string): string {
  return zone === UK_ZONE
    ? ukToday(instant)
    : new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(instant);
}

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
  /** The role section (`shift_requirements.id`) the booking is on. */
  shiftId: string | null;
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

/**
 * Which document the row offers (§11.1, §11.3).
 *
 * The allocation sheet is downloadable before AND during the event — §11.3
 * is explicit that there is "no time restriction on when it can be emailed
 * or downloaded". Once the event is over it becomes the sign-out timesheet.
 * A cancelled event keeps its row, greyed, with no document.
 */
export function documentFor(status: EventStatus): 'allocation' | 'signout' | null {
  if (status === 'cancelled') return null;
  return status === 'completed' ? 'signout' : 'allocation';
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
 */
export interface LineupGroup {
  /** The shift id, or role + window when the row carries none. */
  key: string;
  role: string;
  startsAt: string;
  endsAt: string;
  confirmed: number;
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

  return [...bySection.entries()]
    .map(([key, people]) => {
      // The section carries the role's window; fall back to the booking's
      // own times if a section is missing, so a row is never dropped.
      const first = people[0]!;
      const section = sections.find((s) => s.shiftId === key);
      return {
        key,
        role: section?.role ?? first.role,
        startsAt: section?.startsAt ?? first.startsAt,
        endsAt: section?.endsAt ?? first.endsAt,
        confirmed: people.length,
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
 * The customer's sentence for a refused `submit_client_feedback()` (§11.5).
 *
 * The RPC raises SQLSTATE 22023 for two different things: a rating outside
 * 1–5 ("Rating must be between 1 and 5") and an event that has not started
 * ("Feedback opens once the event has started"). Keyed on the code alone,
 * a bad rating read as "not started yet", so the message decides which.
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
      return 'That could not be saved.';
    case '23505':
      return 'Feedback has already been left for this person on this event.';
    case '42501':
      return 'That booking is not on one of your events.';
    default:
      return 'That could not be saved.';
  }
}

/** Per event id, the document kinds the office has issued (§11.3). */
export type IssuedDocuments = Record<string, ('allocation' | 'signout')[]>;

/**
 * Folds `client_event_documents_v` rows (`event_id`, `kind`) into event id
 * → issued kinds, so the list reads the view once for every event.
 */
export function issuedByEvent(
  rows: readonly { event_id?: unknown; kind?: unknown }[],
): IssuedDocuments {
  const out: IssuedDocuments = {};
  for (const r of rows) {
    if (typeof r.event_id !== 'string') continue;
    if (r.kind !== 'allocation' && r.kind !== 'signout') continue;
    const list = (out[r.event_id] ??= []);
    if (!list.includes(r.kind)) list.push(r.kind);
  }
  return out;
}

/**
 * Which documents a list row offers, and whether each one is live
 * (§11.1, §11.3). `issued` is what `client_event_documents_v` returned for
 * the event: a kind the office has not produced yet is shown, disabled,
 * with an honest "Not issued yet" rather than a link that would 404.
 */
export function documentLink(
  event: Pick<PortalEvent, 'id' | 'status'>,
  issued: readonly ('allocation' | 'signout')[],
): { kind: 'allocation' | 'signout'; href: string | null } | null {
  const kind = documentFor(event.status);
  if (!kind) return null;
  return {
    kind,
    href: issued.includes(kind) ? `/client/events/${event.id}/document?kind=${kind}` : null,
  };
}

/**
 * The Upcoming / Past / All segmented control (§11.1).
 *
 * "Upcoming & ongoing" is anything whose window has not yet ended, so an
 * event running right now stays in the tab the customer is looking at
 * rather than jumping to Past the moment it starts. A cancelled event is
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

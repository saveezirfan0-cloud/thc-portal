import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { isUuid } from './ids';
import type { LineupRow, PortalEvent, RoleSection } from './rules';

/**
 * Reads for the Client Portal (§11.1, §11.2).
 *
 * Every query goes through the anon-key server client, so the caller's own
 * session decides what comes back. The three `client_*` views run with
 * their owner's rights and carry `client_portal_visible()` in their bodies
 * (ADR-0004), which means the tenancy rule is enforced in the database and
 * not by a `where client_id = …` this file could forget. There is
 * deliberately no such filter anywhere below: adding one would hide the bug
 * if the predicate ever came out of a view.
 *
 * The base tables stay closed. Nothing here reads `bookings`,
 * `shift_requirements`, `roles` or `staff`, because the client role holds
 * no policy on any of them and must never be given one (§11.1).
 */

/** True once the app is pointed at a Supabase project (docs/04). */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * What the customer reads when a load fails. Never the database's own
 * message: PostgREST passes Postgres errors through verbatim ("invalid input
 * syntax for type uuid", a column or a constraint name), and those belong in
 * the server log, which is where `logFailure` puts them. An environment with
 * no project (docs/04) is told only to contact THC: the setup step is not
 * the customer's.
 */
export const LOAD_FAILED = {
  list: 'We could not load your events just now. Refresh the page to try again.',
  event: 'We could not load this event just now. Refresh the page to try again.',
  noProject: "The portal isn't connected yet. Please contact THC.",
} as const;

function logFailure(what: string, error: { message?: string; code?: string } | null | undefined) {
  console.error(`[client] ${what} failed`, { code: error?.code, message: error?.message });
}

const EVENT_COLUMNS =
  'id, title, venue_name, venue_address, event_date, po_number, onsite_contact, starts_at, ends_at, status, cancelled_at';
// The list renders no on-site contact (that is §11.2's, the event page), so
// it never asks for one: what the browser is not shown, it is not sent.
const LIST_EVENT_COLUMNS =
  'id, title, venue_name, venue_address, event_date, po_number, starts_at, ends_at, status, cancelled_at';
const SECTION_COLUMNS = 'shift_id, event_id, role, starts_at, ends_at, headcount, confirmed';
const LINEUP_COLUMNS =
  'booking_id, event_id, shift_id, role, starts_at, ends_at, name, photo_path, sort_key, feedback_given, feedback_rating, feedback_sent_at';

/**
 * `PortalEvent` plus the moment a cancelled event was cancelled, for
 * "cancelled <date>" under a greyed row (20261013100300). Null unless
 * `status` is `cancelled`.
 */
export type ClientEvent = PortalEvent & { cancelledAt: string | null };

/**
 * `LineupRow` plus the customer's OWN feedback entry for that worker on that
 * event (20261013100300): its stars (1–5) and when it was sent. Both null
 * until the customer leaves feedback; the office's entries never appear.
 * This is the browser's shape: no `photo_path` (see `LineupRecord`).
 */
export type ClientLineupRow = LineupRow & {
  feedbackRating: number | null;
  feedbackSentAt: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the generated types
   predate these views; regenerating them is `pnpm --filter @thc/db gen:types`
   against a live project, which this environment has not got. */
type Row = Record<string, any>;

function toEvent(r: Row): ClientEvent {
  return {
    id: r.id,
    title: r.title,
    venueName: r.venue_name,
    venueAddress: r.venue_address,
    eventDate: r.event_date,
    poNumber: r.po_number ?? null,
    onsiteContact: r.onsite_contact ?? null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
    cancelledAt: r.cancelled_at ?? null,
  };
}

function toSection(r: Row): RoleSection {
  return {
    shiftId: r.shift_id,
    eventId: r.event_id,
    role: r.role,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    headcount: r.headcount,
    confirmed: r.confirmed,
  };
}

/**
 * A line-up row as the SERVER holds it: the browser's `ClientLineupRow` plus
 * the worker's Storage path, which only `presentLineup` (photos.ts) may read.
 * Never pass one of these to a client component.
 */
export type LineupRecord = ClientLineupRow & {
  photoPath: string | null;
};

function toLineup(r: Row): LineupRecord {
  return {
    bookingId: r.booking_id,
    eventId: r.event_id,
    // The role section (20260930110400): two sections of one role are two
    // groups on the event page, as on the §11.3 PDF.
    shiftId: r.shift_id ?? null,
    role: r.role,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    name: r.name,
    photoPath: r.photo_path ?? null,
    sortKey: r.sort_key,
    feedbackGiven: r.feedback_given === true,
    feedbackRating: typeof r.feedback_rating === 'number' ? r.feedback_rating : null,
    feedbackSentAt: r.feedback_sent_at ?? null,
  };
}

export interface EventListData {
  events: ClientEvent[];
  sections: RoleSection[];
  lineup: LineupRecord[];
  /** The caller's own company (`client_company_v`), for "Events · <client>". */
  company: string | null;
  /** A customer sentence when the list could not be read; never the DB's message. */
  problem: string | null;
}

/** §11.1 · every event this customer has, with its counts and its faces. */
export async function loadEventList(): Promise<EventListData> {
  if (!supabaseConfigured()) {
    return { events: [], sections: [], lineup: [], company: null, problem: LOAD_FAILED.noProject };
  }

  const supabase = createClient(await cookies()) as any;

  const [events, sections, lineup, company] = await Promise.all([
    supabase.from('client_events_v').select(LIST_EVENT_COLUMNS),
    supabase.from('client_role_sections_v').select(SECTION_COLUMNS),
    supabase.from('client_lineup_v').select(LINEUP_COLUMNS),
    // wireframes/client/events.html titles the panel with the customer's
    // own name. One row, the caller's company only (ADR-0004).
    supabase.from('client_company_v').select('name').maybeSingle(),
  ]);

  const failed = [events, sections, lineup].find((r) => r.error);
  if (failed?.error) {
    logFailure('event list', failed.error);
    return { events: [], sections: [], lineup: [], company: null, problem: LOAD_FAILED.list };
  }

  return {
    events: (events.data ?? []).map(toEvent),
    sections: (sections.data ?? []).map(toSection),
    lineup: (lineup.data ?? []).map(toLineup),
    // The name decorates the title; failing to read it withholds nothing.
    company: company.error ? null : (company.data?.name ?? null),
    problem: null,
  };
}

export interface EventPageData {
  event: ClientEvent | null;
  sections: RoleSection[];
  lineup: LineupRecord[];
  /** A customer sentence when the event could not be read; never the DB's message. */
  problem: string | null;
}

/**
 * §11.2 · one event.
 *
 * A wrong id returns `event: null` and the page renders not-found. It is
 * not an authorisation decision the screen is making: the view returned no
 * row because the predicate said so, which is the same answer another
 * customer's event gives.
 *
 * An id that is not a uuid is the same answer, without asking: no event
 * could have it, and asking would only earn Postgres's 22P02.
 */
export async function loadEvent(id: string): Promise<EventPageData> {
  if (!supabaseConfigured()) {
    return { event: null, sections: [], lineup: [], problem: LOAD_FAILED.noProject };
  }
  if (!isUuid(id)) return { event: null, sections: [], lineup: [], problem: null };

  const supabase = createClient(await cookies()) as any;

  const [event, sections, lineup] = await Promise.all([
    supabase.from('client_events_v').select(EVENT_COLUMNS).eq('id', id).maybeSingle(),
    supabase.from('client_role_sections_v').select(SECTION_COLUMNS).eq('event_id', id),
    supabase.from('client_lineup_v').select(LINEUP_COLUMNS).eq('event_id', id),
  ]);

  const failed = [event, sections, lineup].find((r) => r.error);
  if (failed?.error) {
    logFailure('event page', failed.error);
    return { event: null, sections: [], lineup: [], problem: LOAD_FAILED.event };
  }

  return {
    event: event.data ? toEvent(event.data) : null,
    sections: (sections.data ?? []).map(toSection),
    lineup: (lineup.data ?? []).map(toLineup),
    problem: null,
  };
}

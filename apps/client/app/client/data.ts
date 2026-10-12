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

const NO_PROJECT =
  'This environment has no Supabase project, so your events cannot be loaded. See docs/04-setup-github-vercel-supabase.md.';

/**
 * What the customer reads when a query fails. Never the database's own
 * message: PostgREST passes Postgres errors through verbatim ("invalid input
 * syntax for type uuid", a column or a constraint name), and those belong in
 * the server log, which is where `logFailure` puts them.
 */
export const LOAD_FAILED = {
  list: 'We could not load your events just now. Refresh the page to try again.',
  event: 'We could not load this event just now. Refresh the page to try again.',
} as const;

function logFailure(what: string, error: { message?: string; code?: string } | null | undefined) {
  console.error(`[client] ${what} failed`, { code: error?.code, message: error?.message });
}

const EVENT_COLUMNS =
  'id, title, venue_name, venue_address, event_date, po_number, onsite_contact, starts_at, ends_at, status';
// The list renders no on-site contact (that is §11.2's, the event page), so
// it never asks for one: what the browser is not shown, it is not sent.
const LIST_EVENT_COLUMNS =
  'id, title, venue_name, venue_address, event_date, po_number, starts_at, ends_at, status';
const SECTION_COLUMNS = 'shift_id, event_id, role, starts_at, ends_at, headcount, confirmed';
const LINEUP_COLUMNS =
  'booking_id, event_id, shift_id, role, starts_at, ends_at, name, photo_path, sort_key, feedback_given';

/* eslint-disable @typescript-eslint/no-explicit-any -- the generated types
   predate these views; regenerating them is `pnpm --filter @thc/db gen:types`
   against a live project, which this environment has not got. */
type Row = Record<string, any>;

function toEvent(r: Row): PortalEvent {
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
 * A line-up row as the SERVER holds it: the browser's `LineupRow` plus the
 * worker's Storage path, which only `presentLineup` (photos.ts) may read.
 * Never pass one of these to a client component.
 */
export interface LineupRecord extends LineupRow {
  photoPath: string | null;
}

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
  };
}

export interface EventListData {
  events: PortalEvent[];
  sections: RoleSection[];
  lineup: LineupRecord[];
  /** The caller's own company (`client_company_v`), for "Events · <client>". */
  company: string | null;
  problem: string | null;
}

/** §11.1 · every event this customer has, with its counts and its faces. */
export async function loadEventList(): Promise<EventListData> {
  if (!supabaseConfigured()) {
    return { events: [], sections: [], lineup: [], company: null, problem: NO_PROJECT };
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
  event: PortalEvent | null;
  sections: RoleSection[];
  lineup: LineupRecord[];
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
    return { event: null, sections: [], lineup: [], problem: NO_PROJECT };
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

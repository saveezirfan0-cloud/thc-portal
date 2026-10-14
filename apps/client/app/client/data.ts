import { cookies } from 'next/headers';
import { createClient } from '@thc/db/server';
import { ukInstant, ukToday } from '@thc/domain';
import { isUuid } from './ids';
import { isArrivalStatus } from './rules';
import type { LineupRow, PortalEvent, RoleSection } from './rules';
import { addDays, pastWindow, validDay } from './window';
import type { LoadedHistory } from './window';

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
  // More rows than one page may carry (LIST_LIMITS): said, never drawn short.
  tooMany:
    'You have more events in this date range than we can show at once. Choose a shorter range with From and To.',
  event: 'We could not load this event just now. Refresh the page to try again.',
  feedback: 'We could not load your feedback just now. Refresh the page to try again.',
  noProject: "The portal isn't connected yet. Please contact THC.",
} as const;

/**
 * What a signed-in login with no company sees instead of "No events yet";
 * the office address follows it as a mail link ((list)/page.tsx).
 */
export const NOT_LINKED = "Your login isn't linked to a company yet — contact THC at";

function logFailure(what: string, error: { message?: string; code?: string } | null | undefined) {
  console.error(`[client] ${what} failed`, { code: error?.code, message: error?.message });
}

// The event page's header also says who the timesheets go to (ADR-0134 N3).
const EVENT_COLUMNS =
  'id, title, venue_name, venue_address, event_date, po_number, onsite_contact, starts_at, ends_at, status, cancelled_at, timesheet_recipients';
// The list renders no on-site contact (that is §11.2's, the event page), so
// it never asks for one: what the browser is not shown, it is not sent.
const LIST_EVENT_COLUMNS =
  'id, title, venue_name, venue_address, event_date, po_number, starts_at, ends_at, status, cancelled_at';
const LIST_SECTION_COLUMNS = 'shift_id, event_id, role, starts_at, ends_at, headcount, confirmed';
// The event page draws each role's dress code (ADR-0134 N2); the list does not.
const SECTION_COLUMNS = `${LIST_SECTION_COLUMNS}, dress_code`;
const LINEUP_COLUMNS =
  'booking_id, event_id, shift_id, role, starts_at, ends_at, name, photo_path, sort_key, feedback_given, feedback_rating, feedback_sent_at';
// The event page alone says, per person, who has arrived on the day
// (ADR-0135 §1); the list keeps counts only, so it never asks.
const EVENT_LINEUP_COLUMNS = `${LINEUP_COLUMNS}, arrival_status, arrived_at`;

/**
 * `PortalEvent` plus the moment a cancelled event was cancelled, for
 * "cancelled <date>" under a greyed row (20261013100300). Null unless
 * `status` is `cancelled`.
 */
export type ClientEvent = PortalEvent & {
  cancelledAt: string | null;
  /**
   * Who THC emails this event's timesheets to (`client_events_v
   * .timesheet_recipients`, ADR-0089: the event's own list, else the client
   * card's). Read on the event page only; absent on the list.
   */
  timesheetRecipients?: string[];
};

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
    ...(Array.isArray(r.timesheet_recipients)
      ? {
          timesheetRecipients: (r.timesheet_recipients as unknown[]).filter(
            (a): a is string => typeof a === 'string' && a.trim() !== '',
          ),
        }
      : {}),
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
    ...(r.dress_code !== undefined ? { dressCode: r.dress_code ?? null } : {}),
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
    // Only when the read asked for them (the event page, ADR-0135 §1).
    ...('arrival_status' in r
      ? {
          arrivalStatus: isArrivalStatus(r.arrival_status) ? r.arrival_status : null,
          arrivedAt: typeof r.arrived_at === 'string' ? r.arrived_at : null,
        }
      : {}),
  };
}

export interface EventListData {
  events: ClientEvent[];
  sections: RoleSection[];
  lineup: LineupRecord[];
  /** The caller's own company (`client_company_v`), for "Events · <client>". */
  company: string | null;
  /**
   * True when `client_company_v` answered without error and with no row: the
   * login is not linked to a company, so there is nothing the views could
   * return, and the list says so rather than "No events yet". False when the
   * company was read, and when the read failed.
   */
  unlinked: boolean;
  /** The past window that was read (window.ts); null when nothing was read. */
  history: LoadedHistory | null;
  /** A customer sentence when the list could not be read; never the DB's message. */
  problem: string | null;
}

/**
 * The bounds on one list read. PostgREST caps every response at
 * `max_rows` (1000, supabase/config.toml:18 and the hosted default) and says
 * nothing when it does, so every read below asks for ONE MORE row than it
 * will keep: the extra row coming back is how a cap is noticed. Each of
 * `events + 1` and `page + 1` must stay at or under `max_rows`, or
 * the server's cap would bite first and the "+1" would never arrive
 * (__tests__/list-window.test.tsx reads config.toml and holds this).
 */
export const LIST_LIMITS = {
  /** Events per read (not-ended, and the past window, are one read each). */
  events: 500,
  /** Rows per page of sections or line-up; a page that comes back full means read on. */
  page: 500,
  /** Event ids per `.in()` — keeps the request line well inside proxy limits. */
  idsPerRequest: 100,
  /** Line-up or section rows in one list, all pages together; more is "too many". */
  rows: 20_000,
} as const;

type Query = PromiseLike<{ data: Row[] | null; error: { message?: string; code?: string } | null }>;

interface ReadResult {
  rows: Row[];
  error: { message?: string; code?: string } | null;
  truncated: boolean;
}

/**
 * Every row of a view for these event ids, page by page, in a total order.
 * `build(ids, from, to)` must apply that order; `to` is inclusive and one
 * past the page, so a full page is told apart from the last one.
 */
async function readForEvents(
  ids: readonly string[],
  build: (ids: string[], from: number, to: number) => Query,
): Promise<ReadResult> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LIST_LIMITS.idsPerRequest) {
    chunks.push(ids.slice(i, i + LIST_LIMITS.idsPerRequest));
  }

  const results = await Promise.all(
    chunks.map(async (chunk): Promise<ReadResult> => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += LIST_LIMITS.page) {
        const { data, error } = await build(chunk, offset, offset + LIST_LIMITS.page);
        if (error) return { rows, error, truncated: false };
        const page = data ?? [];
        rows.push(...page.slice(0, LIST_LIMITS.page));
        if (page.length <= LIST_LIMITS.page) return { rows, error: null, truncated: false };
        if (rows.length >= LIST_LIMITS.rows) return { rows, error: null, truncated: true };
      }
    }),
  );

  const failed = results.find((r) => r.error);
  if (failed) return failed;
  const rows = results.flatMap((r) => r.rows);
  return {
    rows,
    error: null,
    truncated: results.some((r) => r.truncated) || rows.length > LIST_LIMITS.rows,
  };
}

/** One row per key: a row that moved between two pages mid-read is not counted twice. */
function uniqueBy(rows: readonly Row[], key: string): Row[] {
  const seen = new Set<unknown>();
  return rows.filter((r) => (seen.has(r[key]) ? false : (seen.add(r[key]), true)));
}

function failedList(problem: string): EventListData {
  return {
    events: [],
    sections: [],
    lineup: [],
    company: null,
    unlinked: false,
    history: null,
    problem,
  };
}

/**
 * §11.1 · the customer's events with their counts and their faces: every
 * event that has not ended, and the past ones inside the window the list's
 * address asks for (`pastWindow`, window.ts).
 *
 * Sections and line-up are read only for the events actually loaded
 * (`.in('event_id', …)`), so the list no longer ships every worker the
 * customer ever had to the browser on each refresh. A read that would come
 * back cut short by a cap is not drawn with wrong numbers: it is
 * `LOAD_FAILED.tooMany`, the same amber notice a failed read gets.
 */
export async function loadEventList(
  options: { params?: { get(name: string): string | null }; now?: Date } = {},
): Promise<EventListData> {
  if (!supabaseConfigured()) {
    return failedList(LOAD_FAILED.noProject);
  }

  const params = options.params ?? new URLSearchParams();
  const now = options.now ?? new Date();
  const span = pastWindow(params, ukToday(now));
  // "From" bounds the view exactly: nothing earlier could be shown.
  const fromBounded = validDay(params.get('from')) !== '';
  const nowIso = now.toISOString();
  const sinceIso = ukInstant(span.since, '00:00').toISOString();
  // `until` is inclusive: everything that starts before the next UK midnight.
  const untilIso = span.until ? ukInstant(addDays(span.until, 1), '00:00').toISOString() : null;

  const supabase = createClient(await cookies()) as any;
  const events = () => supabase.from('client_events_v').select(LIST_EVENT_COLUMNS);

  let past = events().lt('ends_at', nowIso).gte('starts_at', sinceIso);
  if (untilIso) past = past.lt('starts_at', untilIso);

  const [current, earlier, older, company] = await Promise.all([
    // Not ended: in full, soonest first.
    events()
      .gte('ends_at', nowIso)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(LIST_LIMITS.events + 1),
    // Ended, inside the window: newest first.
    past
      .order('starts_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(LIST_LIMITS.events + 1),
    // Is there anything before the window? One id is the whole answer. Not
    // asked when "From" bounds the view.
    fromBounded
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('client_events_v')
          .select('id')
          .lt('ends_at', nowIso)
          .lt('starts_at', sinceIso)
          .order('starts_at', { ascending: false })
          .limit(1),
    // wireframes/client/events.html titles the panel with the customer's
    // own name. One row, the caller's company only (ADR-0004).
    supabase.from('client_company_v').select('name').maybeSingle(),
  ]);

  const failed = [current, earlier].find((r) => r.error);
  if (failed?.error) {
    logFailure('event list', failed.error);
    return failedList(LOAD_FAILED.list);
  }
  if (
    (current.data ?? []).length > LIST_LIMITS.events ||
    (earlier.data ?? []).length > LIST_LIMITS.events
  ) {
    logFailure('event list', { message: `more than ${LIST_LIMITS.events} events in one read` });
    return failedList(LOAD_FAILED.tooMany);
  }

  const eventRows = uniqueBy([...(current.data ?? []), ...(earlier.data ?? [])], 'id');
  const ids = eventRows.map((r) => r.id as string);

  const [sections, lineup] = await Promise.all([
    readForEvents(ids, (chunk, from, to) =>
      supabase
        .from('client_role_sections_v')
        .select(LIST_SECTION_COLUMNS)
        .in('event_id', chunk)
        .order('event_id', { ascending: true })
        .order('starts_at', { ascending: true })
        .order('shift_id', { ascending: true })
        .range(from, to),
    ),
    readForEvents(ids, (chunk, from, to) =>
      supabase
        .from('client_lineup_v')
        .select(LINEUP_COLUMNS)
        .in('event_id', chunk)
        .order('event_id', { ascending: true })
        .order('sort_key', { ascending: true })
        .order('booking_id', { ascending: true })
        .range(from, to),
    ),
  ]);

  const broken = [sections, lineup].find((r) => r.error);
  if (broken?.error) {
    logFailure('event list', broken.error);
    return failedList(LOAD_FAILED.list);
  }
  if (sections.truncated || lineup.truncated) {
    logFailure('event list', { message: `more than ${LIST_LIMITS.rows} rows for one list` });
    return failedList(LOAD_FAILED.tooMany);
  }

  // A failed "anything older?" read withholds nothing: offer the link, which
  // at worst shows an empty page further back.
  if (older.error) logFailure('older events check', older.error);
  const hasOlder = older.error ? true : (older.data ?? []).length > 0;

  return {
    events: eventRows.map(toEvent),
    sections: uniqueBy(sections.rows, 'shift_id').map(toSection),
    lineup: uniqueBy(lineup.rows, 'booking_id').map(toLineup),
    // The name decorates the title; failing to read it withholds nothing.
    company: company.error ? null : (company.data?.name ?? null),
    unlinked: !company.error && !company.data,
    history: { ...span, older: hasOlder },
    problem: null,
  };
}

export interface EventPageData {
  event: ClientEvent | null;
  sections: RoleSection[];
  lineup: LineupRecord[];
  /**
   * THC's on-the-day phone number (`client_portal_contact_v`, ADR-0134 N1);
   * null while the office has not set one, or when it could not be read —
   * the page then simply has no "Call THC" link.
   */
  thcPhone: string | null;
  /** A customer sentence when the event could not be read; never the DB's message. */
  problem: string | null;
}

/** No event to show: fresh arrays each time, so no caller shares one. */
function noEvent(problem: string | null): EventPageData {
  return { event: null, sections: [], lineup: [], thcPhone: null, problem };
}

/** The event row alone: what decides between the page and its 404. */
export interface EventRowData {
  event: ClientEvent | null;
  problem: string | null;
}

/** Everything under the event's header: sections, line-up, THC's phone. */
export type EventDetailsData = Omit<EventPageData, 'event'>;

/**
 * §11.2 · the event's own row, read first and on its own (ADR-0134 N9).
 *
 * The page decides between itself and a 404 on this one indexed read
 * before anything is streamed, so a wrong id still answers 404 while the
 * line-up and its photos load under a skeleton (page.tsx).
 *
 * A wrong id returns `event: null` and the page renders not-found. It is
 * not an authorisation decision the screen is making: the view returned no
 * row because the predicate said so, which is the same answer another
 * customer's event gives. An id that is not a uuid is the same answer,
 * without asking: no event could have it, and asking would only earn
 * Postgres's 22P02.
 */
export async function loadEventRow(id: string): Promise<EventRowData> {
  if (!supabaseConfigured()) return { event: null, problem: LOAD_FAILED.noProject };
  if (!isUuid(id)) return { event: null, problem: null };

  const supabase = createClient(await cookies()) as any;
  const event = await supabase
    .from('client_events_v')
    .select(EVENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (event.error) {
    logFailure('event page', event.error);
    return { event: null, problem: LOAD_FAILED.event };
  }
  return { event: event.data ? toEvent(event.data) : null, problem: null };
}

/**
 * §11.2 · the rest of the page: the role sections, the line-up (at most
 * each section's headcount, ADR-0134 §1) and THC's on-the-day phone.
 */
export async function loadEventDetails(id: string): Promise<EventDetailsData> {
  const none = (problem: string | null): EventDetailsData => ({
    sections: [],
    lineup: [],
    thcPhone: null,
    problem,
  });
  if (!supabaseConfigured()) return none(LOAD_FAILED.noProject);
  if (!isUuid(id)) return none(null);

  const supabase = createClient(await cookies()) as any;

  const [sections, lineup, contact] = await Promise.all([
    supabase
      .from('client_role_sections_v')
      .select(SECTION_COLUMNS)
      .eq('event_id', id)
      .order('starts_at', { ascending: true })
      .order('shift_id', { ascending: true }),
    supabase
      .from('client_lineup_v')
      .select(EVENT_LINEUP_COLUMNS)
      .eq('event_id', id)
      .order('sort_key', { ascending: true })
      .order('booking_id', { ascending: true }),
    // One row for a linked client user (ADR-0134 N1).
    supabase.from('client_portal_contact_v').select('phone').maybeSingle(),
  ]);

  const failed = [sections, lineup].find((r) => r.error);
  if (failed?.error) {
    logFailure('event page', failed.error);
    return none(LOAD_FAILED.event);
  }
  // The number is an aid, not the page: failing to read it withholds nothing.
  if (contact?.error) logFailure('THC phone', contact.error);
  const phone = contact?.error ? null : contact?.data?.phone;

  return {
    sections: (sections.data ?? []).map(toSection),
    lineup: (lineup.data ?? []).map(toLineup),
    thcPhone: typeof phone === 'string' && phone.trim() !== '' ? phone.trim() : null,
    problem: null,
  };
}

/**
 * §11.2 · one event, whole: `loadEventRow` and `loadEventDetails` together.
 * Either failing is the page's one customer sentence.
 */
export async function loadEvent(id: string): Promise<EventPageData> {
  if (!supabaseConfigured()) return noEvent(LOAD_FAILED.noProject);
  if (!isUuid(id)) return noEvent(null);

  const [row, details] = await Promise.all([loadEventRow(id), loadEventDetails(id)]);
  const problem = row.problem ?? details.problem;
  if (problem) return noEvent(problem);
  return { event: row.event, ...details };
}

/** One entry of "Feedback you've given" (ADR-0134 N4): the customer's own. */
export interface FeedbackEntry {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  venueName: string;
  /** The event window's start (ISO): the UK date printed beside it. */
  eventStartsAt: string;
  /** The worker's name, or "Deleted account #id" (§1.7). */
  name: string;
  role: string;
  /** The customer's stars, 1–5. */
  rating: number | null;
  /** When the customer sent it (ISO). */
  sentAt: string | null;
  /** The customer's own comment; null when they left none, or the worker was removed. */
  text: string | null;
}

export interface FeedbackHistoryData {
  entries: FeedbackEntry[];
  /** More entries than one read keeps: the page says it shows the latest. */
  truncated: boolean;
  problem: string | null;
}

/** The latest entries one read keeps (and one more, to notice there are more). */
export const HISTORY_LIMIT = 500;

const HISTORY_COLUMNS =
  'booking_id, event_id, role, name, feedback_rating, feedback_sent_at, feedback_text';

/**
 * "Feedback you've given" (ADR-0134 N4): every entry the customer has left,
 * newest first, from `client_lineup_v`'s feedback columns — the customer's
 * OWN entries only (author_kind = client), so the office's never appear —
 * with each event's name, venue and date from `client_events_v`. A worker
 * the customer rated stays on the line-up whatever their seat (ADR-0134
 * §1), so no entry is lost to the headcount trim.
 */
export async function loadFeedbackHistory(): Promise<FeedbackHistoryData> {
  if (!supabaseConfigured()) {
    return { entries: [], truncated: false, problem: LOAD_FAILED.noProject };
  }
  const supabase = createClient(await cookies()) as any;

  const rated = await supabase
    .from('client_lineup_v')
    .select(HISTORY_COLUMNS)
    .eq('feedback_given', true)
    .order('feedback_sent_at', { ascending: false })
    .order('booking_id', { ascending: true })
    .limit(HISTORY_LIMIT + 1);
  if (rated.error) {
    logFailure('feedback history', rated.error);
    return { entries: [], truncated: false, problem: LOAD_FAILED.feedback };
  }
  const rows: Row[] = uniqueBy(rated.data ?? [], 'booking_id');
  const truncated = rows.length > HISTORY_LIMIT;
  const kept = rows.slice(0, HISTORY_LIMIT);

  const ids = [...new Set(kept.map((r) => r.event_id as string))];
  const events = await readForEvents(ids, (chunk, from, to) =>
    supabase
      .from('client_events_v')
      .select('id, title, venue_name, starts_at')
      .in('id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (events.error) {
    logFailure('feedback history', events.error);
    return { entries: [], truncated: false, problem: LOAD_FAILED.feedback };
  }
  const byId = new Map(events.rows.map((e) => [e.id as string, e]));

  const entries = kept.flatMap((r): FeedbackEntry[] => {
    const event = byId.get(r.event_id);
    if (!event) return [];
    const text = typeof r.feedback_text === 'string' ? r.feedback_text.trim() : '';
    return [
      {
        bookingId: r.booking_id,
        eventId: r.event_id,
        eventTitle: event.title,
        venueName: event.venue_name,
        eventStartsAt: event.starts_at,
        name: r.name,
        role: r.role,
        rating: typeof r.feedback_rating === 'number' ? r.feedback_rating : null,
        sentAt: r.feedback_sent_at ?? null,
        text: text === '' ? null : text,
      },
    ];
  });

  return { entries, truncated, problem: null };
}

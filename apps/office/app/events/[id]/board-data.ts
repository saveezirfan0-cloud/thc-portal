import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type CandidateRow,
  type HardGate,
  type ScoreWeights,
  type TimeFormat,
  type SeriesMember,
  normaliseLanguages,
  parseWeights,
  seriesPosition,
  seriesPositionLabel,
  showsUnderUnavailable,
} from '@thc/domain';
import { readAllPages } from '@thc/db/paged';
import type { PageReply } from '@thc/db/paged';
import { signStaffPhotos } from '../../_lib/photos';
import { eventsDb, supabaseConfigured } from '../db';
import {
  type BoardOffer,
  type BoardPersonName,
  type BookingAttendance,
  type CheckLogRow,
  type EndedBooking,
  type Handover,
  type PendingApplication,
  type PoolEntry,
  type UnavailableEntry,
  type UnavailableWindow,
  type ViolationRow,
  attendanceOf,
  buildPool,
  buildUnavailable,
  sectionInEscalation,
  shortName,
} from './board-model';
import { readProblem } from '../../_lib/dbError';

/**
 * Everything the event board reads — Scope §3.3.
 *
 * One query per table rather than a nest of joins, because the board needs
 * the same staff rows in several places (Confirmed, Invited, the pool,
 * Unavailable) and assembling them here keeps each list's rule visible
 * instead of buried in a select string.
 *
 * Every list is computed fresh on each open (§3.4: "calculated fresh every
 * time the event page is opened, not a cached snapshot"): the pool and the
 * Unavailable reasons come from `auto_assign_candidates`, the same function
 * the engine rounds read, and are ranked with the engine's own ranking.
 * Once a section has started, the pool is the ESCALATION pool
 * (`p_escalation`): the radius gate and nearest-first, as the 10-minute
 * job sees it (§3.4). Attendance on Confirmed rows is read from
 * `check_logs` and `violations` on the same open.
 *
 * Two reads, because the pool is the slow part (ADR-0161; go-live audit H2:
 * one `auto_assign_candidates` call per section, 0.2–7.5 s each under load,
 * was what held the whole board on 17.10). `loadBoard` reads the event, its
 * sections and everyone booked on them — the header, Confirmed, Invited and
 * the Radar applicants — and decides between the board and a 404.
 * `loadSectionPools` reads ONE section's pool and calendar; the board
 * streams each behind its own Suspense (`SectionPools`), so a slow pool
 * never holds the line-up, nor one section another.
 *
 * A failed query is reported, never mistaken for an empty or missing
 * event: the page shows `problem` in an Alert. Only a query that SUCCEEDS
 * and finds no row is "not found".
 */

export interface BoardBooking extends BoardPersonName {
  bookingId: string;
  status: string;
  source: string;
  createdAt: string;
  confirmedAt: string | null;
  dayBeforeConfirmedAt: string | null;
  appliedAt: string | null;
  /** §9.6: qualified at THIS client and THIS role — the Wave 1 chip. */
  qualified: boolean;
  /** An unresolved No-show (§3.3): badged in Confirmed, with Get back. */
  noShow: boolean;
  reconfirmRequired: boolean;
  /**
   * ADR-0046: the open offer on a confirmed booking — a chip, never a move:
   * the worker stays confirmed until somebody takes it.
   */
  offer: BoardOffer | null;
  /** On shift / Checked out / Late / Left early / No check-out (wireframe). */
  attendance: BookingAttendance;
}

export interface BoardSection {
  id: string;
  roleId: string;
  roleName: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  buffer: number;
  /**
   * From `shift_rates_v` (ADR-0061): null for an office role without
   * finance, and the header then draws no rate line at all.
   */
  chargeRate: number | null;
  payRate: number | null;
  dressCode: string;
  autoAssign: boolean;
  /** ADR-0079: the gender the client asked for on this role, or null for anyone. */
  requiredGender: 'M' | 'F' | null;
  /** ADR-0117: the client wants the same staff on every day of this job for this role. */
  sameStaffAllDays: boolean;
  allocationPerHour: number;
  confirmed: BoardBooking[];
  invited: BoardBooking[];
  /**
   * Pending Radar self-applications (§3.3, §10.4): `applied`, oldest first.
   * They sit in the Potential pool with the "Applied" marker; an invited
   * worker who also applied is one row in `invited`, never here too.
   */
  applied: BoardBooking[];
  /** ADR-0046: completed hand-overs on this section, oldest first. */
  handovers: Handover[];
  /** Under way: the pool is the escalation pool (radius, nearest first, §3.4). */
  escalation: boolean;
  /** What this section's streamed pool needs from the first read (`loadSectionPools`). */
  poolInput: SectionPoolInput;
}

/**
 * One section's pool, from the board's first read: who is booked here and
 * how, so the pool and Unavailable can leave them out or label them.
 */
export interface SectionPoolInput {
  shiftId: string;
  /** Under way: the escalation pool (radius gate, nearest first, §3.4). */
  escalation: boolean;
  /** Pending Radar self-applications, for the pool's Applied marker. */
  applications: PendingApplication[];
  /** Cancelled and closed bookings here (D33: most are invitable again). */
  ended: EndedBooking[];
  /** Workers with a live booking here: listed in its own blocks, never in Unavailable. */
  live: string[];
}

/** The people the first read already named, and the role catalogue's names. */
export interface BoardPeople {
  people: ReadonlyMap<string, BoardPersonName>;
  roleNames: ReadonlyMap<string, string>;
}

/** One section's Potential pool and Unavailable list (`loadSectionPools`). */
export interface SectionPools {
  /** The ranked Potential pool, or null when the candidates could not be read. */
  pool: PoolEntry[] | null;
  /** Why `pool` is null — shown on the section rather than hidden. */
  poolProblem: string | null;
  unavailable: UnavailableEntry[];
  /**
   * ADR-0043: set when `auto_assign_unavailable` could not be read. The
   * pool is still shown, but it may list workers the engine will skip.
   */
  calendarProblem: string | null;
}

export interface BoardEvent {
  id: string;
  title: string;
  date: string;
  clientId: string;
  clientName: string;
  /** The client card's Name badges switch (ADR-0081). */
  nameBadges: boolean;
  /** The contact emails on the client card (§9.7): who a timesheet goes to by default. */
  clientContactEmails: string[];
  /** ADR-0089: this event's own recipients, or null = every contact email on the client card. */
  documentRecipients: string[] | null;
  venueName: string;
  venueAddress: string;
  poNumber: string;
  notes: string;
  onsiteContact: string;
  autoAssign: boolean;
  /** ADR-0080: English plus any language the client asked for. */
  requiredLanguages: string[];
  /**
   * ADR-0117: "Day 2 of 3" when this event is one day of a multi-day job
   * (`events.series_id`) with other live days; null when it stands alone.
   */
  seriesLabel: string | null;
  paysBreaks: boolean;
  paysBuffer: boolean;
  cancelledAt: string | null;
  cancelReason: string;
  payrollExportedAt: string | null;
  /** §6 weights as `settings.scoring_weights` holds them, for the legend. */
  weights: ScoreWeights;
  sections: BoardSection[];
  /** Everyone booked on the event, by staff id, and the role names: the pools reuse them. */
  known: BoardPeople;
}

export interface BoardLoad {
  event: BoardEvent | null;
  /** Set when the board could not be read. `event` is then null. */
  problem: string | null;
}

const NO_SUPABASE =
  'This environment has no Supabase project, so the event board cannot be loaded (docs/04-setup-github-vercel-supabase.md).';

interface StaffRow {
  id: string;
  first_name: string;
  last_name: string;
  removed_at: string | null;
  employee_id: number | null;
  photo_path: string | null;
}

/**
 * PostgREST carries `in.(…)` in the URL, and a role's pool can reach most
 * of the ~1,000 workers. Chunked so the request line stays well inside
 * every proxy's limit and no single response meets the row cap.
 */
const IN_CHUNK = 150;

/** One `shift_offers` row as the board reads it (ADR-0046). */
interface OfferRow {
  id: string;
  booking_id: string;
  shift_id: string;
  mode: 'pool' | 'office' | 'direct';
  status: string;
  note: string | null;
  expires_at: string;
  closed_at: string | null;
  taken_by_booking_id: string | null;
}

/** One `auto_assign_unavailable` row: an entry overlapping the section's window. */
interface AwayRow {
  staff_id: string;
  starts_at: string;
  ends_at: string;
}

/** A paged read the board can order and range — table, view or RPC alike. */
interface PagedQuery<T> extends PromiseLike<PageReply<T>> {
  order(column: string): PagedQuery<T>;
  range(from: number, to: number): PagedQuery<T>;
}

/** `auto_assign_unavailable` (20260930201000), not yet in the generated types. */
interface UnavailableRpc {
  rpc(fn: 'auto_assign_unavailable', args: { p_shift: string }): PagedQuery<AwayRow>;
}

async function selectIn<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: readonly string[],
  /** A total order for the chunk's rows, so a chunk past max_rows pages without loss. */
  order: readonly string[],
  equals: Readonly<Record<string, string>> = {},
  alsoIn: Readonly<Record<string, readonly string[]>> = {},
): Promise<{ rows: T[]; error: string | null }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  // A chunk of 150 workers × every role they hold can pass PostgREST's
  // 1000-row cap, which cuts without an error (go-live audit M3): each chunk
  // is read in pages.
  const results = await Promise.all(
    chunks.map((chunk) =>
      readAllPages<T>((range) => {
        let query = supabase.from(table).select(columns).in(column, chunk);
        for (const [key, value] of Object.entries(equals)) query = query.eq(key, value);
        for (const [key, values] of Object.entries(alsoIn)) query = query.in(key, [...values]);
        for (const key of order) query = query.order(key);
        return query.range(range.from, range.to) as unknown as PromiseLike<PageReply<T>>;
      }),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { rows: [], error: failed.error.message };
  return { rows: results.flatMap((r) => r.data ?? []), error: null };
}

/** Far past any directory THC will hold; past it a pool read is an error, never a cut. */
const POOL_CEILING = 20_000;

export async function loadBoard(eventId: string, now: Date = new Date()): Promise<BoardLoad> {
  if (!supabaseConfigured()) return { event: null, problem: NO_SUPABASE };
  const supabase = eventsDb(await cookies());

  // Go-live audit H2: the board used to read in six steps, one after
  // another. Everything that needs only the event id now starts with the
  // event itself; what needs the event row (its client, its series) starts
  // with the bookings and pools, which need only the section ids.
  const [eventRes, sectionRes, roleRes, settingRes, rateRes] = await Promise.all([
    supabase
      .from('events')
      .select(
        'id, title, event_date, client_id, venue_name, venue_address, po_number, notes, onsite_contact, auto_assign, required_languages, series_id, pays_breaks, pays_buffer, cancelled_at, cancel_reason, payroll_exported_at, document_recipients',
      )
      .eq('id', eventId)
      .maybeSingle(),
    supabase
      .from('shift_requirements')
      .select(
        'id, role_id, starts_at, ends_at, headcount, buffer, dress_code, auto_assign, required_gender, same_staff_all_days, allocation_per_hour',
      )
      .eq('event_id', eventId)
      .order('starts_at'),
    supabase.from('roles').select('id, name'),
    supabase.from('settings').select('value').eq('key', 'scoring_weights').maybeSingle(),
    // ADR-0061: the rates are not selectable on shift_requirements; this
    // view returns them to an office role with finance and no row otherwise.
    supabase
      .from('shift_rates_v')
      .select('shift_id, pay_rate, charge_rate')
      .eq('event_id', eventId),
  ]);
  const { data: eventRow, error: eventError } = eventRes;
  if (eventError)
    return { event: null, problem: readProblem(eventError, 'The event could not be read') };
  if (!eventRow) return { event: null, problem: null };
  const event = eventRow as Record<string, string | boolean | null>;

  // ADR-0117: "Day 2 of 3", read live with the page. Only a context line, so a
  // failed read drops it rather than the board.
  const seriesRead = event['series_id']
    ? supabase
        .from('events')
        .select('id, event_date, cancelled_at')
        .eq('series_id', event['series_id'] as string)
    : null;
  const clientRead = supabase
    .from('clients')
    .select('name, name_badges, contact_emails')
    .eq('id', event['client_id'] as string)
    .maybeSingle();

  const firstError = sectionRes.error ?? roleRes.error ?? rateRes.error;
  if (firstError) {
    return { event: null, problem: readProblem(firstError, 'The event board could not be read') };
  }
  // A missing or unreadable weights row falls back to the §6 default — the
  // same rule the engine applies (parseWeights), so the two cannot differ.
  const weights = parseWeights((settingRes.data as { value?: unknown } | null)?.value);

  const sections = (sectionRes.data ?? []) as Record<string, string | number | boolean | null>[];
  const rates = new Map(
    (
      (rateRes.data ?? []) as {
        shift_id: string;
        pay_rate: number | string;
        charge_rate: number | string;
      }[]
    ).map((r) => [r.shift_id, r]),
  );
  const roleNames = new Map(
    ((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );
  const sectionIds = sections.map((s) => s['id'] as string);
  const sectionRoleIds = [...new Set(sections.map((s) => s['role_id'] as string))];
  const escalating = new Set(
    sections
      .filter((s) =>
        sectionInEscalation(
          { startsAt: s['starts_at'] as string, endsAt: s['ends_at'] as string },
          now,
        ),
      )
      .map((s) => s['id'] as string),
  );

  // The bookings and offers on every section, with the client and series
  // reads that waited for the event row. The candidate pool and the
  // calendar are NOT read here: each section streams its own
  // (`loadSectionPools`), so the line-up never waits for them.
  const [bookingRes, offerRes, clientRes, seriesRes] = await Promise.all([
    sectionIds.length
      ? readAllPages<Record<string, string | boolean | null>>(
          (range) =>
            supabase
              .from('bookings')
              .select(
                'id, shift_id, staff_id, status, source, created_at, confirmed_at, day_before_confirmed_at, applied_at, reconfirm_required, cancel_cause',
              )
              .in('shift_id', sectionIds)
              .order('id')
              .range(range.from, range.to) as unknown as PromiseLike<
              PageReply<Record<string, string | boolean | null>>
            >,
          { what: 'bookings', key: (row) => row['id'] as string },
        )
      : Promise.resolve({ data: [], error: null }),
    // ADR-0046: open offers (the Confirmed-row chips) and completed
    // hand-overs (the section's history line). The office reads
    // shift_offers through its admin_read policy. Paged by id: a long-lived
    // section collects taken hand-overs, and a cut list would drop a chip.
    sectionIds.length
      ? readAllPages<OfferRow>(
          (range) =>
            supabase
              .from('shift_offers')
              .select(
                'id, booking_id, shift_id, mode, status, note, expires_at, closed_at, taken_by_booking_id',
              )
              .in('shift_id', sectionIds)
              .in('status', ['open', 'taken'])
              .order('id')
              .range(range.from, range.to) as unknown as PromiseLike<PageReply<OfferRow>>,
          { what: 'shift offers', key: (row) => row.id },
        )
      : Promise.resolve({ data: [] as OfferRow[], error: null }),
    clientRead,
    seriesRead,
  ]);
  if (clientRes.error) {
    return {
      event: null,
      problem: readProblem(clientRes.error, 'The event board could not be read'),
    };
  }
  let seriesLabel: string | null = null;
  if (seriesRes) {
    const members: SeriesMember[] = (
      (seriesRes.data ?? []) as {
        id: string;
        event_date: string;
        cancelled_at: string | null;
      }[]
    ).map((d) => ({ eventId: d.id, date: d.event_date, cancelled: d.cancelled_at !== null }));
    const position = seriesPosition(eventId, members);
    seriesLabel = position ? seriesPositionLabel(position) : null;
  }
  if (bookingRes.error) {
    return {
      event: null,
      problem: readProblem(bookingRes.error, 'The bookings on this event could not be read'),
    };
  }
  // An unread offer must not look like "nobody has offered anything up".
  if (offerRes.error) {
    return {
      event: null,
      problem: readProblem(offerRes.error, 'The shift offers on this event could not be read'),
    };
  }
  const bookings = (bookingRes.data ?? []) as Record<string, string | boolean | null>[];
  const offerRows = offerRes.data ?? [];
  const openOffers = new Map<string, BoardOffer>(
    offerRows
      .filter((o) => o.status === 'open')
      .map((o) => [
        o.booking_id,
        { offerId: o.id, mode: o.mode, expiresAt: o.expires_at, note: o.note },
      ]),
  );
  // Everyone the line-up names: booked on a section. The candidates the
  // pool and Unavailable show are named by `loadSectionPools`.
  const staffIds = [...new Set<string>(bookings.map((b) => b['staff_id'] as string))];

  const bookingIds = bookings.map((b) => b['id'] as string);
  const [staffRes, staffRoleRes, qualRes, violationRes, checkLogRes] = await Promise.all([
    selectIn<StaffRow>(
      supabase,
      'staff',
      'id, first_name, last_name, removed_at, employee_id, photo_path',
      'id',
      staffIds,
      ['id'],
    ),
    selectIn<{ staff_id: string; role_id: string }>(
      supabase,
      'staff_roles',
      'staff_id, role_id',
      'staff_id',
      staffIds,
      ['staff_id', 'role_id'],
    ),
    // The Wave 1 chip: qualified at this client for one of THIS event's
    // roles, for the workers the board names — never the client's whole
    // qualification set, which is staff × roles and passes 1000 rows
    // (go-live audit M3), turning Wave 1 labels into Wave 2.
    selectIn<{ staff_id: string; role_id: string }>(
      supabase,
      'client_qualifications',
      'staff_id, role_id',
      'staff_id',
      staffIds,
      ['staff_id', 'role_id'],
      { client_id: event['client_id'] as string, do_not_return: 'false' },
      { role_id: sectionRoleIds },
    ),
    selectIn<{
      booking_id: string;
      type: string;
      resolved: boolean;
      minutes_late: number | null;
      actual_finish_at: string | null;
    }>(
      supabase,
      'violations',
      'booking_id, type, resolved, minutes_late, actual_finish_at',
      'booking_id',
      bookingIds,
      ['id'],
    ),
    selectIn<{
      booking_id: string;
      outcome: string;
      check_in_at: string | null;
      check_out_at: string | null;
      manager_finish_at: string | null;
    }>(
      supabase,
      'check_logs',
      'booking_id, outcome, check_in_at, check_out_at, manager_finish_at',
      'booking_id',
      bookingIds,
      ['id'],
    ),
  ]);
  // A failed read of the no-show badges or the attendance must not show
  // nobody as a no-show or everyone as absent, so it is a problem like the
  // rest rather than an empty set.
  const peopleError =
    staffRes.error ??
    staffRoleRes.error ??
    qualRes.error ??
    violationRes.error ??
    checkLogRes.error;
  if (peopleError) {
    return {
      event: null,
      problem: readProblem(peopleError, 'The workers on this event could not be read'),
    };
  }

  const people = await namePeople(staffRes.rows, staffRoleRes.rows, roleNames);
  const qualified = new Set(qualRes.rows.map((q) => `${q.staff_id}:${q.role_id}`));
  const violationsByBooking = new Map<string, ViolationRow[]>();
  for (const v of violationRes.rows) {
    const list = violationsByBooking.get(v.booking_id) ?? [];
    list.push({
      type: v.type,
      resolved: Boolean(v.resolved),
      minutesLate: v.minutes_late,
      actualFinishAt: v.actual_finish_at,
    });
    violationsByBooking.set(v.booking_id, list);
  }
  const logsByBooking = new Map<string, CheckLogRow[]>();
  for (const l of checkLogRes.rows) {
    const list = logsByBooking.get(l.booking_id) ?? [];
    list.push({
      outcome: l.outcome,
      checkInAt: l.check_in_at,
      checkOutAt: l.check_out_at,
      managerFinishAt: l.manager_finish_at,
    });
    logsByBooking.set(l.booking_id, list);
  }
  // Recorded by hand or at start + 30, and not yet reversed by Get back /
  // Resolve (§3.3, §9.5).
  const noShows = new Set(
    violationRes.rows.filter((v) => v.type === 'no_show' && !v.resolved).map((v) => v.booking_id),
  );

  const toBooking = (
    row: Record<string, string | boolean | null>,
    roleId: string,
  ): BoardBooking => {
    const person = people.get(row['staff_id'] as string) ?? {
      staffId: row['staff_id'] as string,
      name: 'Deleted account',
      roles: [],
    };
    return {
      ...person,
      bookingId: row['id'] as string,
      status: row['status'] as string,
      source: row['source'] as string,
      createdAt: row['created_at'] as string,
      confirmedAt: (row['confirmed_at'] as string) ?? null,
      dayBeforeConfirmedAt: (row['day_before_confirmed_at'] as string) ?? null,
      appliedAt: (row['applied_at'] as string) ?? null,
      qualified: qualified.has(`${person.staffId}:${roleId}`),
      noShow: noShows.has(row['id'] as string),
      reconfirmRequired: Boolean(row['reconfirm_required']),
      offer: openOffers.get(row['id'] as string) ?? null,
      attendance: attendanceOf(
        logsByBooking.get(row['id'] as string) ?? [],
        violationsByBooking.get(row['id'] as string) ?? [],
      ),
    };
  };

  // "Handed over: {from} → {to} · {date}" — both people hold a booking on
  // the section (the original cancelled / handed_over, the taker's), so
  // both are already named.
  const bookingStaff = new Map(bookings.map((b) => [b['id'] as string, b['staff_id'] as string]));
  const nameOf = (bookingId: string | null) => {
    const staffId = bookingId ? bookingStaff.get(bookingId) : undefined;
    return (staffId && people.get(staffId)?.name) || 'Deleted account';
  };
  const handovers = (shiftId: string): Handover[] =>
    offerRows
      .filter((o) => o.shift_id === shiftId && o.status === 'taken' && o.closed_at)
      .sort((a, b) => (a.closed_at ?? '').localeCompare(b.closed_at ?? ''))
      .map((o) => ({
        fromName: nameOf(o.booking_id),
        toName: nameOf(o.taken_by_booking_id),
        at: o.closed_at!,
      }));

  return {
    problem: null,
    event: {
      id: event['id'] as string,
      title: event['title'] as string,
      date: event['event_date'] as string,
      clientId: event['client_id'] as string,
      clientName: ((clientRes.data as { name?: string } | null)?.name ?? 'Client') as string,
      nameBadges: (clientRes.data as { name_badges?: boolean } | null)?.name_badges === true,
      clientContactEmails:
        (clientRes.data as { contact_emails?: string[] | null } | null)?.contact_emails ?? [],
      documentRecipients:
        (eventRow as { document_recipients?: string[] | null }).document_recipients ?? null,
      venueName: event['venue_name'] as string,
      venueAddress: event['venue_address'] as string,
      poNumber: (event['po_number'] as string) ?? '',
      notes: (event['notes'] as string) ?? '',
      onsiteContact: (event['onsite_contact'] as string) ?? '',
      autoAssign: Boolean(event['auto_assign']),
      requiredLanguages: normaliseLanguages(event['required_languages'] as string[] | null),
      seriesLabel,
      paysBreaks: Boolean(event['pays_breaks']),
      paysBuffer: Boolean(event['pays_buffer']),
      cancelledAt: (event['cancelled_at'] as string) ?? null,
      cancelReason: (event['cancel_reason'] as string) ?? '',
      payrollExportedAt: (event['payroll_exported_at'] as string) ?? null,
      weights,
      known: { people, roleNames },
      sections: sections.map((section) => {
        const id = section['id'] as string;
        const roleId = section['role_id'] as string;
        const mine = bookings.filter((b) => b['shift_id'] === id);
        const applied = mine
          .filter((b) => b['status'] === 'applied')
          .map((b) => toBooking(b, roleId))
          .sort((a, b) => (a.appliedAt ?? a.createdAt).localeCompare(b.appliedAt ?? b.createdAt));
        // Everyone with a live booking here is listed in its own section.
        const live = [
          ...new Set(
            mine
              .filter((b) => b['status'] !== 'cancelled' && b['status'] !== 'closed')
              .map((b) => b['staff_id'] as string),
          ),
        ];
        const ended: EndedBooking[] = mine
          .filter((b) => b['status'] === 'cancelled' || b['status'] === 'closed')
          .map((b) => ({
            staffId: b['staff_id'] as string,
            status: b['status'] as string,
            cancelCause: (b['cancel_cause'] as string) ?? null,
            appliedAt: (b['applied_at'] as string) ?? null,
            // invite_worker never reopens a booking with history (D33).
            hasHistory:
              logsByBooking.has(b['id'] as string) || violationsByBooking.has(b['id'] as string),
          }));

        return {
          id,
          roleId,
          roleName: roleNames.get(roleId) ?? 'Role',
          startsAt: section['starts_at'] as string,
          endsAt: section['ends_at'] as string,
          headcount: section['headcount'] as number,
          buffer: section['buffer'] as number,
          chargeRate: rates.has(id) ? Number(rates.get(id)!.charge_rate) : null,
          payRate: rates.has(id) ? Number(rates.get(id)!.pay_rate) : null,
          dressCode: (section['dress_code'] as string) ?? '',
          autoAssign: Boolean(section['auto_assign']),
          requiredGender: (section['required_gender'] as 'M' | 'F' | null) ?? null,
          sameStaffAllDays: Boolean(section['same_staff_all_days']),
          allocationPerHour: section['allocation_per_hour'] as number,
          // A no-show stays in Confirmed, badged — never moved out (§3.3).
          confirmed: mine
            .filter((b) => b['status'] === 'confirmed' || b['status'] === 'worked')
            .map((b) => toBooking(b, roleId)),
          invited: mine.filter((b) => b['status'] === 'invited').map((b) => toBooking(b, roleId)),
          applied,
          handovers: handovers(id),
          escalation: escalating.has(id),
          poolInput: {
            shiftId: id,
            escalation: escalating.has(id),
            applications: applied.map((a) => ({
              staffId: a.staffId,
              bookingId: a.bookingId,
              appliedAt: a.appliedAt,
              createdAt: a.createdAt,
            })),
            ended,
            live,
          },
        };
      }),
    },
  };
}

/**
 * Board rows for these workers: a short name (§1.7's anonymisation for a
 * removed worker), the roles they hold, and the selfie. The selfie is a key
 * in the private `photos` bucket, not a URL: one batched signing (reused
 * across refreshes, _lib/photos.ts), and an unsigned path leaves that row on
 * initials. A removed worker shows no face, whatever the column still holds.
 */
async function namePeople(
  staff: readonly StaffRow[],
  staffRoles: readonly { staff_id: string; role_id: string }[],
  roleNames: ReadonlyMap<string, string>,
): Promise<Map<string, BoardPersonName>> {
  const facePath = (s: StaffRow) => (s.removed_at === null ? s.photo_path : null);
  const photoUrls = await signStaffPhotos(staff.map(facePath));
  const rolesByStaff = new Map<string, string[]>();
  for (const sr of staffRoles) {
    const list = rolesByStaff.get(sr.staff_id) ?? [];
    list.push(roleNames.get(sr.role_id) ?? 'Role');
    rolesByStaff.set(sr.staff_id, list);
  }
  return new Map(
    staff.map((s) => [
      s.id,
      {
        staffId: s.id,
        name: shortName({
          first: s.first_name,
          last: s.last_name,
          removed: s.removed_at !== null,
          employeeId: s.employee_id,
        }),
        roles: (rolesByStaff.get(s.id) ?? []).sort(),
        photoUrl: photoUrls.get(facePath(s) ?? '') ?? null,
      },
    ]),
  );
}

/**
 * One section's Potential pool and Unavailable list (§3.3, §3.4, ADR-0043),
 * read and ranked now — the board streams each section's behind its own
 * Suspense (ADR-0161), so this is the only call that waits for
 * `auto_assign_candidates`.
 *
 * A failed candidate read is `pool: null` with the reason (the section says
 * so, and still offers its Radar applicants); a failed calendar read is
 * `calendarProblem` beside a pool that may list workers the engine will
 * skip. Neither takes the board down.
 */
export async function loadSectionPools(
  input: SectionPoolInput,
  known: BoardPeople,
  weights: ScoreWeights,
  /** The operator's clock (ADR-0085), for the windows Unavailable names. */
  format?: TimeFormat,
): Promise<SectionPools> {
  if (!supabaseConfigured()) {
    return { pool: null, poolProblem: NO_SUPABASE, unavailable: [], calendarProblem: null };
  }
  const supabase = eventsDb(await cookies());

  const [candidateRes, awayRes] = await Promise.all([
    // One row per worker in the directory comes back, most of them
    // wrong_role — which never produces a row on the board (§6), nor does
    // the other gender on a gender-only section (ADR-0079), nor a worker
    // who does not speak a language the event needs (ADR-0080). Filtered in
    // the database, so only the workers the board can show cross the wire —
    // and paged by staff_id (unique per row; the function has no ORDER BY
    // of its own), because at full roster even those pass PostgREST's
    // 1000-row cap (go-live audit H5).
    readAllPages<CandidateRow>(
      (range) =>
        supabase
          .rpc('auto_assign_candidates', {
            p_shift: input.shiftId,
            p_escalation: input.escalation,
          })
          .or('gate.is.null,gate.not.in.(wrong_role,male_only,female_only,language_not_spoken)')
          .order('staff_id')
          .range(range.from, range.to) as unknown as PromiseLike<PageReply<CandidateRow>>,
      { what: 'candidates', key: (row) => row.staff_id, ceiling: POOL_CEILING },
    ),
    // ADR-0043: who marked this ROLE SECTION's window unavailable (RULE-18).
    // A new RPC, typed locally until the Phase 2 type regeneration. One row
    // per entry, and a holiday week takes in most of the roster: paged in a
    // total order, so the 1,001st entry is not silently "available".
    readAllPages<AwayRow>(
      (range) =>
        (supabase as unknown as UnavailableRpc)
          .rpc('auto_assign_unavailable', { p_shift: input.shiftId })
          .order('staff_id')
          .order('starts_at')
          .order('ends_at')
          .range(range.from, range.to),
      { what: 'availability entries', ceiling: POOL_CEILING },
    ),
  ]);

  const windows = new Map<string, UnavailableWindow[]>();
  for (const row of awayRes.data ?? []) {
    const list = windows.get(row.staff_id) ?? [];
    list.push({ startsAt: row.starts_at, endsAt: row.ends_at });
    windows.set(row.staff_id, list);
  }
  const calendarProblem = awayRes.error
    ? readProblem(awayRes.error, 'The availability calendar could not be read')
    : null;
  if (candidateRes.error) {
    return {
      pool: null,
      poolProblem: readProblem(candidateRes.error, 'The candidate pool could not be computed'),
      unavailable: [],
      calendarProblem,
    };
  }
  const rows = candidateRes.data;

  // The candidates the pool or Unavailable will show and the first read did
  // not name. wrong_role and the other gender never produce a row (§6,
  // ADR-0079), so those workers are not even looked up.
  const unnamed = [
    ...new Set(
      rows
        .filter((row) => !row.gate || showsUnderUnavailable(row.gate as HardGate))
        .map((row) => row.staff_id)
        .filter((id) => !known.people.has(id)),
    ),
  ];
  const [staffRes, staffRoleRes] = await Promise.all([
    selectIn<StaffRow>(
      supabase,
      'staff',
      'id, first_name, last_name, removed_at, employee_id, photo_path',
      'id',
      unnamed,
      ['id'],
    ),
    selectIn<{ staff_id: string; role_id: string }>(
      supabase,
      'staff_roles',
      'staff_id, role_id',
      'staff_id',
      unnamed,
      ['staff_id', 'role_id'],
    ),
  ]);
  const namesError = staffRes.error ?? staffRoleRes.error;
  if (namesError) {
    return {
      pool: null,
      poolProblem: readProblem(namesError, 'The workers in the candidate pool could not be read'),
      unavailable: [],
      calendarProblem,
    };
  }
  const people = new Map(known.people);
  for (const [id, person] of await namePeople(staffRes.rows, staffRoleRes.rows, known.roleNames)) {
    people.set(id, person);
  }

  return {
    pool: buildPool(rows, people, input.applications, weights, {
      ended: input.ended,
      proximityFirst: input.escalation,
      unavailable: new Set(windows.keys()),
    }),
    poolProblem: null,
    unavailable: buildUnavailable(rows, input.ended, people, new Set(input.live), windows, format),
    calendarProblem,
  };
}

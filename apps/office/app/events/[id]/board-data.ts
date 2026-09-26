import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type CandidateRow, type ScoreWeights, parseWeights } from '@thc/domain';
import { eventsDb, supabaseConfigured } from '../db';
import {
  type BoardOffer,
  type BoardPersonName,
  type BookingAttendance,
  type CheckLogRow,
  type EndedBooking,
  type Handover,
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
  chargeRate: number;
  payRate: number;
  dressCode: string;
  autoAssign: boolean;
  allocationPerHour: number;
  confirmed: BoardBooking[];
  invited: BoardBooking[];
  /**
   * Pending Radar self-applications (§3.3, §10.4): `applied`, oldest first.
   * They sit in the Potential pool with the "Applied" marker; an invited
   * worker who also applied is one row in `invited`, never here too.
   */
  applied: BoardBooking[];
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
  /** ADR-0046: completed hand-overs on this section, oldest first. */
  handovers: Handover[];
  /** Under way: the pool is the escalation pool (radius, nearest first, §3.4). */
  escalation: boolean;
}

export interface BoardEvent {
  id: string;
  title: string;
  date: string;
  clientId: string;
  clientName: string;
  venueName: string;
  venueAddress: string;
  poNumber: string;
  notes: string;
  onsiteContact: string;
  autoAssign: boolean;
  paysBreaks: boolean;
  paysBuffer: boolean;
  cancelledAt: string | null;
  cancelReason: string;
  payrollExportedAt: string | null;
  /** §6 weights as `settings.scoring_weights` holds them, for the legend. */
  weights: ScoreWeights;
  sections: BoardSection[];
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

/** `auto_assign_unavailable` (20260930201000), not yet in the generated types. */
interface UnavailableRpc {
  rpc(
    fn: 'auto_assign_unavailable',
    args: { p_shift: string },
  ): PromiseLike<{
    data: { staff_id: string; starts_at: string; ends_at: string }[] | null;
    error: { message: string } | null;
  }>;
}

async function selectIn<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: readonly string[],
  equals: Readonly<Record<string, string>> = {},
): Promise<{ rows: T[]; error: string | null }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) => {
      let query = supabase.from(table).select(columns).in(column, chunk);
      for (const [key, value] of Object.entries(equals)) query = query.eq(key, value);
      return query;
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { rows: [], error: failed.error.message };
  return { rows: results.flatMap((r) => (r.data ?? []) as T[]), error: null };
}

export async function loadBoard(eventId: string, now: Date = new Date()): Promise<BoardLoad> {
  if (!supabaseConfigured()) return { event: null, problem: NO_SUPABASE };
  const supabase = eventsDb(await cookies());

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .select(
      'id, title, event_date, client_id, venue_name, venue_address, po_number, notes, onsite_contact, auto_assign, pays_breaks, pays_buffer, cancelled_at, cancel_reason, payroll_exported_at',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (eventError)
    return { event: null, problem: `The event could not be read: ${eventError.message}` };
  if (!eventRow) return { event: null, problem: null };
  const event = eventRow as Record<string, string | boolean | null>;

  const [sectionRes, clientRes, roleRes, settingRes] = await Promise.all([
    supabase
      .from('shift_requirements')
      .select(
        'id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate, dress_code, auto_assign, allocation_per_hour',
      )
      .eq('event_id', eventId)
      .order('starts_at'),
    supabase
      .from('clients')
      .select('name')
      .eq('id', event['client_id'] as string)
      .maybeSingle(),
    supabase.from('roles').select('id, name'),
    supabase.from('settings').select('value').eq('key', 'scoring_weights').maybeSingle(),
  ]);
  const firstError = sectionRes.error ?? clientRes.error ?? roleRes.error;
  if (firstError) {
    return { event: null, problem: `The event board could not be read: ${firstError.message}` };
  }
  // A missing or unreadable weights row falls back to the §6 default — the
  // same rule the engine applies (parseWeights), so the two cannot differ.
  const weights = parseWeights((settingRes.data as { value?: unknown } | null)?.value);

  const sections = (sectionRes.data ?? []) as Record<string, string | number | boolean | null>[];
  const roleNames = new Map(
    ((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );
  const sectionIds = sections.map((s) => s['id'] as string);
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

  // Bookings, the candidate pool and the availability calendar per
  // section — each computed now.
  const [bookingRes, candidateRes, awayRes, offerRes] = await Promise.all([
    sectionIds.length
      ? supabase
          .from('bookings')
          .select(
            'id, shift_id, staff_id, status, source, created_at, confirmed_at, day_before_confirmed_at, applied_at, reconfirm_required, cancel_cause',
          )
          .in('shift_id', sectionIds)
      : Promise.resolve({ data: [], error: null }),
    // One row per worker in the directory comes back, most of them
    // wrong_role — which never produces a row on the board (§6). Filtered
    // in the database, so the response stays far inside PostgREST's row
    // cap and only the role's own workers cross the wire.
    Promise.all(
      sectionIds.map((id) =>
        supabase
          .rpc('auto_assign_candidates', { p_shift: id, p_escalation: escalating.has(id) })
          .or('gate.is.null,gate.neq.wrong_role'),
      ),
    ),
    // ADR-0043: who marked each ROLE SECTION's window unavailable (RULE-18).
    // A new RPC, typed locally until the Phase 2 type regeneration.
    Promise.all(
      sectionIds.map((id) =>
        (supabase as unknown as UnavailableRpc).rpc('auto_assign_unavailable', { p_shift: id }),
      ),
    ),
    // ADR-0046: open offers (the Confirmed-row chips) and completed
    // hand-overs (the section's history line). The office reads
    // shift_offers through its admin_read policy.
    sectionIds.length
      ? supabase
          .from('shift_offers')
          .select(
            'id, booking_id, shift_id, mode, status, note, expires_at, closed_at, taken_by_booking_id',
          )
          .in('shift_id', sectionIds)
          .in('status', ['open', 'taken'])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (bookingRes.error) {
    return {
      event: null,
      problem: `The bookings on this event could not be read: ${bookingRes.error.message}`,
    };
  }
  // An unread offer must not look like "nobody has offered anything up".
  if (offerRes.error) {
    return {
      event: null,
      problem: `The shift offers on this event could not be read: ${offerRes.error.message}`,
    };
  }
  const bookings = (bookingRes.data ?? []) as Record<string, string | boolean | null>[];
  const offerRows = (offerRes.data ?? []) as OfferRow[];
  const openOffers = new Map<string, BoardOffer>(
    offerRows
      .filter((o) => o.status === 'open')
      .map((o) => [
        o.booking_id,
        { offerId: o.id, mode: o.mode, expiresAt: o.expires_at, note: o.note },
      ]),
  );
  const candidates = new Map<string, { rows: CandidateRow[] | null; problem: string | null }>(
    sectionIds.map((id, i) => {
      const res = candidateRes[i]!;
      return [
        id,
        res.error
          ? {
              rows: null,
              problem: `The candidate pool could not be computed: ${res.error.message}`,
            }
          : { rows: (res.data ?? []) as CandidateRow[], problem: null },
      ];
    }),
  );

  const away = new Map<
    string,
    { windows: Map<string, UnavailableWindow[]>; problem: string | null }
  >(
    sectionIds.map((id, i) => {
      const res = awayRes[i]!;
      const windows = new Map<string, UnavailableWindow[]>();
      for (const row of res.data ?? []) {
        const list = windows.get(row.staff_id) ?? [];
        list.push({ startsAt: row.starts_at, endsAt: row.ends_at });
        windows.set(row.staff_id, list);
      }
      return [
        id,
        {
          windows,
          problem: res.error
            ? `The availability calendar could not be read: ${res.error.message}`
            : null,
        },
      ];
    }),
  );

  // Everyone the board will name: booked on a section, or a candidate the
  // pool or Unavailable will show. wrong_role never produces a row (§6),
  // so those workers are not even looked up.
  const named = new Set<string>(bookings.map((b) => b['staff_id'] as string));
  for (const { rows } of candidates.values()) {
    for (const row of rows ?? []) if (row.gate !== 'wrong_role') named.add(row.staff_id);
  }
  const staffIds = [...named];

  const bookingIds = bookings.map((b) => b['id'] as string);
  const [staffRes, staffRoleRes, qualRes, violationRes, checkLogRes] = await Promise.all([
    selectIn<StaffRow>(
      supabase,
      'staff',
      'id, first_name, last_name, removed_at, employee_id',
      'id',
      staffIds,
    ),
    selectIn<{ staff_id: string; role_id: string }>(
      supabase,
      'staff_roles',
      'staff_id, role_id',
      'staff_id',
      staffIds,
    ),
    supabase
      .from('client_qualifications')
      .select('staff_id, role_id')
      .eq('client_id', event['client_id'] as string)
      .eq('do_not_return', false),
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
    ),
  ]);
  // A failed read of the no-show badges or the attendance must not show
  // nobody as a no-show or everyone as absent, so it is a problem like the
  // rest rather than an empty set.
  const peopleError =
    staffRes.error ??
    staffRoleRes.error ??
    qualRes.error?.message ??
    violationRes.error ??
    checkLogRes.error;
  if (peopleError) {
    return { event: null, problem: `The workers on this event could not be read: ${peopleError}` };
  }

  const rolesByStaff = new Map<string, string[]>();
  for (const sr of staffRoleRes.rows) {
    const list = rolesByStaff.get(sr.staff_id) ?? [];
    list.push(roleNames.get(sr.role_id) ?? 'Role');
    rolesByStaff.set(sr.staff_id, list);
  }
  const people = new Map<string, BoardPersonName>(
    staffRes.rows.map((s) => [
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
      },
    ]),
  );
  const qualified = new Set(
    ((qualRes.data ?? []) as { staff_id: string; role_id: string }[]).map(
      (q) => `${q.staff_id}:${q.role_id}`,
    ),
  );
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
      venueName: event['venue_name'] as string,
      venueAddress: event['venue_address'] as string,
      poNumber: (event['po_number'] as string) ?? '',
      notes: (event['notes'] as string) ?? '',
      onsiteContact: (event['onsite_contact'] as string) ?? '',
      autoAssign: Boolean(event['auto_assign']),
      paysBreaks: Boolean(event['pays_breaks']),
      paysBuffer: Boolean(event['pays_buffer']),
      cancelledAt: (event['cancelled_at'] as string) ?? null,
      cancelReason: (event['cancel_reason'] as string) ?? '',
      payrollExportedAt: (event['payroll_exported_at'] as string) ?? null,
      weights,
      sections: sections.map((section) => {
        const id = section['id'] as string;
        const roleId = section['role_id'] as string;
        const mine = bookings.filter((b) => b['shift_id'] === id);
        const applied = mine
          .filter((b) => b['status'] === 'applied')
          .map((b) => toBooking(b, roleId))
          .sort((a, b) => (a.appliedAt ?? a.createdAt).localeCompare(b.appliedAt ?? b.createdAt));
        const { rows, problem } = candidates.get(id)!;
        const calendar = away.get(id)!;

        // Everyone with a live booking here is listed in its own section.
        const live = new Set(
          mine
            .filter((b) => b['status'] !== 'cancelled' && b['status'] !== 'closed')
            .map((b) => b['staff_id'] as string),
        );
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
          chargeRate: Number(section['charge_rate']),
          payRate: Number(section['pay_rate']),
          dressCode: (section['dress_code'] as string) ?? '',
          autoAssign: Boolean(section['auto_assign']),
          allocationPerHour: section['allocation_per_hour'] as number,
          // A no-show stays in Confirmed, badged — never moved out (§3.3).
          confirmed: mine
            .filter((b) => b['status'] === 'confirmed' || b['status'] === 'worked')
            .map((b) => toBooking(b, roleId)),
          invited: mine.filter((b) => b['status'] === 'invited').map((b) => toBooking(b, roleId)),
          applied,
          pool: rows
            ? buildPool(
                rows,
                people,
                applied.map((a) => ({
                  staffId: a.staffId,
                  bookingId: a.bookingId,
                  appliedAt: a.appliedAt,
                  createdAt: a.createdAt,
                })),
                weights,
                {
                  ended,
                  proximityFirst: escalating.has(id),
                  unavailable: new Set(calendar.windows.keys()),
                },
              )
            : null,
          poolProblem: problem,
          unavailable: buildUnavailable(rows, ended, people, live, calendar.windows),
          calendarProblem: calendar.problem,
          handovers: handovers(id),
          escalation: escalating.has(id),
        };
      }),
    },
  };
}

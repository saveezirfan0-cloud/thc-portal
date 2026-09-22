import { cookies } from 'next/headers';
import { eventsDb, supabaseConfigured } from '../db';

/**
 * Everything the event board reads — Scope §3.3.
 *
 * One query per table rather than a nest of joins, because the board needs
 * the same staff rows in three different places (Confirmed, Invited, the
 * pool) and assembling them here keeps each list's rule visible instead of
 * buried in a select string.
 */

export interface BoardPerson {
  staffId: string;
  /** "Grace L." — Avatar derives the initials, including the GDPR case. */
  name: string;
  /** Roles this worker is signed off for, for the pool's second line. */
  roles: string[];
}

export interface BoardBooking extends BoardPerson {
  bookingId: string;
  status: string;
  source: string;
  createdAt: string;
  confirmedAt: string | null;
  dayBeforeConfirmedAt: string | null;
  appliedAt: string | null;
  /** §9.6: qualified at THIS client and THIS role — the Wave 1 chip. */
  qualified: boolean;
  noShow: boolean;
  reconfirmRequired: boolean;
}

export interface BoardCandidate extends BoardPerson {
  qualified: boolean;
  appliedAt: string | null;
  /** The §6 factors, as stored on the worker. */
  reliability: number;
  rating: number;
  distanceKm: number;
  futureShifts: number;
  venueTimes: number;
}

export interface BoardUnavailable extends BoardPerson {
  /** One of scoring.ts's HARD_GATES. */
  gate: string;
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
  unavailable: BoardUnavailable[];
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
  sections: BoardSection[];
}

interface StaffRow {
  id: string;
  first_name: string;
  last_name: string;
}

export async function loadBoard(eventId: string): Promise<BoardEvent | null> {
  if (!supabaseConfigured()) return null;
  const supabase = eventsDb(await cookies());

  const { data: eventRow } = await supabase
    .from('events')
    .select(
      'id, title, event_date, client_id, venue_name, venue_address, po_number, notes, onsite_contact, auto_assign, pays_breaks, pays_buffer, cancelled_at, cancel_reason, payroll_exported_at',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!eventRow) return null;
  const event = eventRow as Record<string, string | boolean | null>;

  const [{ data: sectionData }, { data: clientRow }, { data: roleData }] = await Promise.all([
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
  ]);

  const sections = (sectionData ?? []) as Record<string, string | number | boolean | null>[];
  const roleNames = new Map(
    ((roleData ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );

  const sectionIds = sections.map((s) => s['id'] as string);

  // Bookings, the staff behind them, and the client qualifications that
  // decide the Wave 1 chip (§9.6, RULE-17).
  const { data: bookingData } = sectionIds.length
    ? await supabase
        .from('bookings')
        .select(
          'id, shift_id, staff_id, status, source, created_at, confirmed_at, day_before_confirmed_at, applied_at, reconfirm_required',
        )
        .in('shift_id', sectionIds)
    : { data: [] };
  const bookings = (bookingData ?? []) as Record<string, string | boolean | null>[];

  const staffIds = [...new Set(bookings.map((b) => b['staff_id'] as string))];
  const [{ data: staffData }, { data: qualData }, { data: violationData }] = await Promise.all([
    staffIds.length
      ? supabase.from('staff').select('id, first_name, last_name').in('id', staffIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('client_qualifications')
      .select('staff_id, role_id')
      .eq('client_id', event['client_id'] as string),
    bookings.length
      ? supabase
          .from('violations')
          .select('booking_id, type')
          .eq('type', 'no_show')
          .in(
            'booking_id',
            bookings.map((b) => b['id'] as string),
          )
      : Promise.resolve({ data: [] }),
  ]);

  const staff = new Map(
    ((staffData ?? []) as StaffRow[]).map((s) => [
      s.id,
      {
        staffId: s.id,
        name: `${s.first_name} ${s.last_name.charAt(0)}.`,
        roles: [] as string[],
      },
    ]),
  );
  const qualified = new Set(
    ((qualData ?? []) as { staff_id: string; role_id: string }[]).map(
      (q) => `${q.staff_id}:${q.role_id}`,
    ),
  );
  const noShows = new Set(
    ((violationData ?? []) as { booking_id: string }[]).map((v) => v.booking_id),
  );

  const toBooking = (
    row: Record<string, string | boolean | null>,
    roleId: string,
  ): BoardBooking => {
    const person = staff.get(row['staff_id'] as string) ?? {
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
    };
  };

  return {
    id: event['id'] as string,
    title: event['title'] as string,
    date: event['event_date'] as string,
    clientId: event['client_id'] as string,
    clientName: ((clientRow as { name?: string } | null)?.name ?? 'Client') as string,
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
    sections: sections.map((section) => {
      const id = section['id'] as string;
      const roleId = section['role_id'] as string;
      const mine = bookings.filter((b) => b['shift_id'] === id);
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
        // Self-cancelled and blocked bookings are the "rejected" reason (§3.6).
        unavailable: mine
          .filter((b) => b['status'] === 'cancelled')
          .map((b) => ({
            ...toBooking(b, roleId),
            gate: 'self_cancelled',
          })),
      };
    }),
  };
}

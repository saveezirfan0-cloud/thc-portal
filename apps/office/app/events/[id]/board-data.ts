import { cookies } from 'next/headers';
import { eventsDb, supabaseConfigured } from '../db';
import { type RowRecord, type StaffNameRow, personLabel, unavailableGate } from './board-rules';

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
  /** "Grace L.", or "Deleted account #1042" once GDPR-removed (§1.7). */
  name: string;
  /** No photo and no initials: the removed worker keeps their row (§1.7). */
  deleted: boolean;
  /** Roles this worker is signed off for, for the pool's second line. */
  roles: string[];
}

export interface BoardBooking extends BoardPerson, RowRecord {
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
  /** The open no_show violation, which "Get back" resolves (§3.3). */
  noShowViolationId: string | null;
  reconfirmRequired: boolean;
  cancelCause: string | null;
  /** Per BOOKING, not per event: this shift's line went to finance (§9.9). */
  payrollExported: boolean;
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
  /**
   * Pending Radar self-applications (§3.3, §10.4): `applied`, oldest first.
   * They sit in the Potential pool with the "Applied" marker; an invited
   * worker who also applied is one row in `invited`, never here too.
   */
  applied: BoardBooking[];
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
  geofenceRadiusM: number | null;
  poNumber: string;
  notes: string;
  onsiteContact: string;
  autoAssign: boolean;
  paysBreaks: boolean;
  paysBuffer: boolean;
  cancelledAt: string | null;
  cancelReason: string;
  payrollExportedAt: string | null;
  /** settings.escalation_radius_miles — the pill on a short Ongoing role (§3.4). */
  escalationRadiusMiles: number;
  sections: BoardSection[];
}

interface StaffRow extends StaffNameRow {
  id: string;
}

interface ViolationRow {
  id: string;
  booking_id: string;
  type: string;
  resolved: boolean;
  minutes_late: number | null;
}

interface PayableRow {
  booking_id: string;
  check_in_at: string | null;
  check_out_at: string | null;
  unpaid_break_min: number | null;
  pay: { status?: string; payableMin?: number } | null;
}

export async function loadBoard(eventId: string): Promise<BoardEvent | null> {
  if (!supabaseConfigured()) return null;
  const supabase = eventsDb(await cookies());

  const { data: eventRow } = await supabase
    .from('events')
    .select(
      'id, title, event_date, client_id, venue_name, venue_address, geofence_radius_m, po_number, notes, onsite_contact, auto_assign, pays_breaks, pays_buffer, cancelled_at, cancel_reason, payroll_exported_at',
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!eventRow) return null;
  const event = eventRow as Record<string, string | number | boolean | null>;

  const [{ data: sectionData }, { data: clientRow }, { data: roleData }, { data: radiusRow }] =
    await Promise.all([
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
      supabase.from('settings').select('value').eq('key', 'escalation_radius_miles').maybeSingle(),
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
          'id, shift_id, staff_id, status, source, created_at, confirmed_at, day_before_confirmed_at, applied_at, reconfirm_required, cancel_cause',
        )
        .in('shift_id', sectionIds)
    : { data: [] };
  const bookings = (bookingData ?? []) as Record<string, string | boolean | null>[];
  const bookingIds = bookings.map((b) => b['id'] as string);

  const staffIds = [...new Set(bookings.map((b) => b['staff_id'] as string))];
  const [
    { data: staffData },
    { data: qualData },
    { data: violationData },
    { data: payableData },
    { data: exportData },
  ] = await Promise.all([
    staffIds.length
      ? supabase
          .from('staff')
          .select('id, first_name, last_name, removed_at, employee_id')
          .in('id', staffIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from('client_qualifications')
      .select('staff_id, role_id')
      .eq('client_id', event['client_id'] as string),
    // Every type: no_show for the badge and Get back, late / left_early /
    // no_checkout for the row's pills and payable line (§3.3, RULE-01).
    bookingIds.length
      ? supabase
          .from('violations')
          .select('id, booking_id, type, resolved, minutes_late')
          .in('booking_id', bookingIds)
      : Promise.resolve({ data: [] }),
    // The check-in record and RULE-01's payable minutes, as the payroll
    // export computes them — never re-derived here.
    bookingIds.length
      ? supabase
          .from('payable_shifts_v')
          .select('booking_id, check_in_at, check_out_at, unpaid_break_min, pay')
          .in('booking_id', bookingIds)
      : Promise.resolve({ data: [] }),
    // Per booking, not per event: a held No check-out is left OUT of the
    // Monday run, so the event having been exported says nothing about
    // this shift (§9.9, 20260923130000).
    bookingIds.length
      ? supabase
          .from('payroll_export_lines')
          .select('booking_id')
          .eq('state', 'exported')
          .in('booking_id', bookingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const staff = new Map(
    ((staffData ?? []) as StaffRow[]).map((s) => [
      s.id,
      { staffId: s.id, ...personLabel(s), roles: [] as string[] },
    ]),
  );
  const qualified = new Set(
    ((qualData ?? []) as { staff_id: string; role_id: string }[]).map(
      (q) => `${q.staff_id}:${q.role_id}`,
    ),
  );
  const violationsByBooking = new Map<string, ViolationRow[]>();
  for (const v of (violationData ?? []) as ViolationRow[]) {
    const list = violationsByBooking.get(v.booking_id) ?? [];
    list.push(v);
    violationsByBooking.set(v.booking_id, list);
  }
  const payable = new Map(
    ((payableData ?? []) as PayableRow[]).map((row) => [row.booking_id, row]),
  );
  const exported = new Set(
    ((exportData ?? []) as { booking_id: string }[]).map((row) => row.booking_id),
  );

  const toBooking = (
    row: Record<string, string | boolean | null>,
    roleId: string,
  ): BoardBooking => {
    const id = row['id'] as string;
    const person = staff.get(row['staff_id'] as string) ?? {
      staffId: row['staff_id'] as string,
      name: 'Deleted account #unknown',
      deleted: true,
      roles: [],
    };
    const violations = violationsByBooking.get(id) ?? [];
    const noShow = violations.find((v) => v.type === 'no_show' && !v.resolved) ?? null;
    const late = violations.find((v) => v.type === 'late') ?? null;
    const noCheckout = violations.find((v) => v.type === 'no_checkout') ?? null;
    const record = payable.get(id);
    return {
      ...person,
      bookingId: id,
      status: row['status'] as string,
      source: row['source'] as string,
      createdAt: row['created_at'] as string,
      confirmedAt: (row['confirmed_at'] as string) ?? null,
      dayBeforeConfirmedAt: (row['day_before_confirmed_at'] as string) ?? null,
      appliedAt: (row['applied_at'] as string) ?? null,
      qualified: qualified.has(`${person.staffId}:${roleId}`),
      noShow: noShow !== null,
      noShowViolationId: noShow?.id ?? null,
      reconfirmRequired: Boolean(row['reconfirm_required']),
      cancelCause: (row['cancel_cause'] as string) ?? null,
      payrollExported: exported.has(id),
      checkInAt: record?.check_in_at ?? null,
      checkOutAt: record?.check_out_at ?? null,
      payableMin:
        record?.pay?.status === 'settled' && typeof record.pay.payableMin === 'number'
          ? record.pay.payableMin
          : null,
      unpaidBreakMin: record?.unpaid_break_min ?? 0,
      minutesLate: late?.minutes_late ?? null,
      leftEarly: violations.some((v) => v.type === 'left_early'),
      noCheckout: noCheckout ? { id: noCheckout.id, resolved: noCheckout.resolved } : null,
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
    geofenceRadiusM: (event['geofence_radius_m'] as number) ?? null,
    poNumber: (event['po_number'] as string) ?? '',
    notes: (event['notes'] as string) ?? '',
    onsiteContact: (event['onsite_contact'] as string) ?? '',
    autoAssign: Boolean(event['auto_assign']),
    paysBreaks: Boolean(event['pays_breaks']),
    paysBuffer: Boolean(event['pays_buffer']),
    cancelledAt: (event['cancelled_at'] as string) ?? null,
    cancelReason: (event['cancel_reason'] as string) ?? '',
    payrollExportedAt: (event['payroll_exported_at'] as string) ?? null,
    escalationRadiusMiles: Number((radiusRow as { value?: unknown } | null)?.value ?? 3) || 3,
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
        applied: mine
          .filter((b) => b['status'] === 'applied')
          .map((b) => toBooking(b, roleId))
          .sort((a, b) => (a.appliedAt ?? a.createdAt).localeCompare(b.appliedAt ?? b.createdAt)),
        // Only a self-cancel is RULE-04's "rejected"; an overlap withdrawal
        // is "booked elsewhere"; an office withdrawal, a cutoff release or
        // the event's own cancellation lists nobody (unavailableGate).
        unavailable: mine
          .filter((b) => b['status'] === 'cancelled')
          .flatMap((b) => {
            const gate = unavailableGate((b['cancel_cause'] as string) ?? null);
            return gate ? [{ ...toBooking(b, roleId), gate }] : [];
          }),
      };
    }),
  };
}

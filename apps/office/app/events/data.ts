import { cookies } from 'next/headers';
import {
  type BufferSuggestionRule,
  type SeriesMember,
  UK_ZONE,
  formatTimeIn,
  normaliseLanguages,
  readBufferRule,
} from '@thc/domain';
import { readAllPages } from '@thc/db/paged';
import type { PageReply } from '@thc/db/paged';
import { eventsDb, supabaseConfigured } from './db';
import { readProblem } from '../_lib/dbError';

/**
 * Everything the Shift Builder reads — Scope §3.2.
 *
 * Reference data comes from the directories the other bots own: clients
 * (§9.6), venues (§9.11) and roles & rates (§9.10). Nothing here writes.
 * RLS is what protects these rows; the middleware only keeps the wrong role
 * out of the wrong app.
 *
 * Rates (ADR-0061): no signed-in session may select a rate column on
 * `roles`, `client_rate_cards` or `shift_requirements`. They are read from
 * `role_rates_v`, `rate_card_rates_v` and `shift_rates_v`, which answer an
 * office role with finance and return no row to a scheduler — so for a
 * scheduler every rate here is 0 and the screens do not draw it
 * (`ratesVisible`). What is saved never depends on these figures for a
 * scheduler: the database sets the catalogue rates on their sections.
 */

export interface RoleOption {
  id: string;
  name: string;
  /**
   * Base £/h from Roles & rates. Editable per role section on this screen.
   * 0 when the viewer's office role has no finance (ADR-0061).
   */
  payRate: number;
}

export interface ClientOption {
  id: string;
  name: string;
  staffContactPoint: string;
  contactEmails: string[];
  paysBreaks: boolean;
  paysBuffer: boolean;
  /** Charge rate and dress codes per role, from this client's rate card (§9.7). */
  rateCard: Record<string, { chargeRate: number; dressCodes: string[] }>;
}

export interface VenueOption {
  id: string;
  name: string;
  address: string;
  venueType: string;
  venueTypeLabel: string;
  geofenceRadiusM: number;
}

export interface ReferenceData {
  clients: ClientOption[];
  venues: VenueOption[];
  roles: RoleOption[];
  /**
   * ADR-0181: the suggested-buffer rule (`settings.buffer_suggestion`), or
   * THC's default (one for every five, rounded up; under five none unless
   * the role starts before 08:00, then one) when the row is missing or
   * unreadable.
   */
  bufferRule: BufferSuggestionRule;
  /** Set when this environment has no Supabase project wired up yet. */
  unavailable?: string;
}

const NO_SUPABASE =
  'This environment has no Supabase project, so clients, venues and roles cannot be loaded (docs/04-setup-github-vercel-supabase.md).';

interface ClientRow {
  id: string;
  name: string;
  staff_contact_point: string;
  contact_emails: string[] | null;
  pays_breaks: boolean;
  pays_buffer: boolean;
}
interface RateCardRow {
  client_id: string;
  role_id: string;
  dress_codes: string[] | null;
}
interface RateCardChargeRow {
  client_id: string;
  role_id: string;
  charge_rate: number | string;
}
interface VenueRow {
  id: string;
  name: string;
  address: string;
  venue_type: string;
  geofence_radius_m: number;
}
interface RoleRow {
  id: string;
  name: string;
}
interface RoleRateRow {
  role_id: string;
  pay_rate: number | string;
}

export async function loadReferenceData(): Promise<ReferenceData> {
  if (!supabaseConfigured()) {
    return {
      clients: [],
      venues: [],
      roles: [],
      bufferRule: readBufferRule(null),
      unavailable: NO_SUPABASE,
    };
  }

  const supabase = eventsDb(await cookies());

  const [clients, rateCards, venues, venueTypes, roles, charges, payRates, bufferRow] =
    await Promise.all([
      supabase
        .from('clients')
        .select('id, name, staff_contact_point, contact_emails, pays_breaks, pays_buffer')
        .order('name'),
      supabase.from('client_rate_cards').select('client_id, role_id, dress_codes'),
      supabase
        .from('venues')
        .select('id, name, address, venue_type, geofence_radius_m')
        .is('deleted_at', null)
        .order('name'),
      supabase.from('venue_types').select('key, label'),
      supabase.from('roles').select('id, name').order('name'),
      // ADR-0061: empty for an office role without finance.
      supabase.from('rate_card_rates_v').select('client_id, role_id, charge_rate'),
      supabase.from('role_rates_v').select('role_id, pay_rate'),
      // ADR-0181: every office role reads settings (only writes need an owner).
      supabase.from('settings').select('value').eq('key', 'buffer_suggestion').maybeSingle(),
    ]);

  // A failed read is reported, not rendered as "no clients" — the builder
  // would otherwise offer an empty picker with no explanation.
  const failed = [clients, rateCards, venues, venueTypes, roles, charges, payRates].find(
    (r) => r.error,
  )?.error;
  if (failed) {
    return {
      clients: [],
      venues: [],
      roles: [],
      bufferRule: readBufferRule(null),
      unavailable: readProblem(failed, 'Clients, venues and roles could not be loaded'),
    };
  }

  const typeLabels = new Map(
    ((venueTypes.data ?? []) as { key: string; label: string }[]).map((t) => [t.key, t.label]),
  );

  const chargeOf = new Map(
    ((charges.data ?? []) as RateCardChargeRow[]).map((c) => [
      `${c.client_id}:${c.role_id}`,
      Number(c.charge_rate),
    ]),
  );
  const payOf = new Map(
    ((payRates.data ?? []) as RoleRateRow[]).map((r) => [r.role_id, Number(r.pay_rate)]),
  );

  const cardsByClient = new Map<string, ClientOption['rateCard']>();
  for (const card of (rateCards.data ?? []) as RateCardRow[]) {
    const forClient = cardsByClient.get(card.client_id) ?? {};
    forClient[card.role_id] = {
      chargeRate: chargeOf.get(`${card.client_id}:${card.role_id}`) ?? 0,
      dressCodes: card.dress_codes ?? [],
    };
    cardsByClient.set(card.client_id, forClient);
  }

  return {
    clients: ((clients.data ?? []) as ClientRow[]).map((c) => ({
      id: c.id,
      name: c.name,
      staffContactPoint: c.staff_contact_point,
      contactEmails: c.contact_emails ?? [],
      paysBreaks: c.pays_breaks,
      paysBuffer: c.pays_buffer,
      rateCard: cardsByClient.get(c.id) ?? {},
    })),
    venues: ((venues.data ?? []) as VenueRow[]).map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      venueType: v.venue_type,
      venueTypeLabel: typeLabels.get(v.venue_type) ?? v.venue_type,
      geofenceRadiusM: v.geofence_radius_m,
    })),
    roles: ((roles.data ?? []) as RoleRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      payRate: payOf.get(r.id) ?? 0,
    })),
    // A failed read of the one setting is not worth refusing the builder
    // for: the suggestion falls back to the default, and the manager can
    // always type the buffer.
    bufferRule: readBufferRule(
      bufferRow.error ? null : (bufferRow.data as { value: unknown } | null)?.value,
    ),
  };
}

/** What the Scheduling filter and the saved-views bar need of a client: no rate card. */
export type ClientName = Pick<ClientOption, 'id' | 'name'>;

/**
 * The clients for /events' filter and saved views — id and name, one query.
 *
 * `loadReferenceData` is the Shift Builder's: seven reads (rate cards, venues,
 * the two rate views…). The list page only ever drew the client names from it,
 * and re-ran all seven every 15 s with the auto-refresh.
 */
export async function loadClientNames(): Promise<{ clients: ClientName[]; unavailable?: string }> {
  if (!supabaseConfigured()) return { clients: [], unavailable: NO_SUPABASE };
  const supabase = eventsDb(await cookies());
  // The toolbar's client filter: paged by (name, id), so a client past row
  // 1,000 is not missing from it (go-live audit 17.10.2026).
  const { data, error } = await readAllPages<ClientName>(
    (range) =>
      supabase
        .from('clients')
        .select('id, name')
        .order('name')
        .order('id')
        .range(range.from, range.to) as unknown as PromiseLike<PageReply<ClientName>>,
    { what: 'clients', key: (row) => row.id },
  );
  if (error) {
    return {
      clients: [],
      unavailable: readProblem(error, 'Clients could not be loaded'),
    };
  }
  return { clients: data };
}

export interface SavedRoleSection {
  id: string;
  roleId: string;
  /** Europe/London wall clock, as the builder's inputs carry it. */
  start: string;
  end: string;
  headcount: number;
  buffer: number;
  chargeRate: number;
  payRate: number;
  dressCode: string;
  autoAssign: boolean;
  /** ADR-0079: the gender the client asked for on this role, or null for anyone. */
  requiredGender: 'M' | 'F' | null;
  /** ADR-0117: the client wants the same staff on every day of this job for this role. */
  sameStaffAllDays: boolean;
  allocationPerHour: number;
  /** Confirmed bookings on THIS role section — who re-confirms if it moves. */
  confirmed: number;
  /**
   * Every booking still standing on this section, invitations included.
   * Deleting the section would cascade these away, so the builder refuses
   * while any remain: leaving a booking is the manager's call on the event
   * board, through Withdraw (§3.3, §3.6).
   */
  booked: number;
  /**
   * Of `booked`, the ones confirmed or past it — what keeps Remove off
   * (ADR-0160). The rest are pending invitations and applications, which
   * a save that removes the section closes, telling each worker.
   */
  held: number;
}

export interface SavedEvent {
  id: string;
  clientId: string;
  venueId: string;
  title: string;
  date: string;
  poNumber: string;
  onsiteContact: string;
  notes: string;
  autoAssign: boolean;
  /** ADR-0080: English plus any language the client asked for. */
  requiredLanguages: string[];
  /** ADR-0185: staff must bring a passport or driving licence. */
  securityCleared: boolean;
  cancelledAt: string | null;
  /**
   * ADR-0117: every event of the multi-day job this one belongs to (itself
   * included), by date; empty when it stands alone. `seriesPosition()` turns
   * it into "Day 2 of 3".
   */
  seriesDays: SeriesMember[];
  sections: SavedRoleSection[];
}

interface EventRow {
  id: string;
  client_id: string;
  venue_id: string | null;
  title: string;
  event_date: string;
  po_number: string | null;
  onsite_contact: string | null;
  notes: string | null;
  auto_assign: boolean;
  required_languages: string[] | null;
  security_cleared: boolean | null;
  cancelled_at: string | null;
  series_id: string | null;
}

interface SectionRow {
  id: string;
  role_id: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  buffer: number;
  dress_code: string | null;
  auto_assign: boolean;
  required_gender: 'M' | 'F' | null;
  same_staff_all_days: boolean;
  allocation_per_hour: number;
}

/** `shift_rates_v` (ADR-0061) — no row for an office role without finance. */
export interface SectionRateRow {
  shift_id: string;
  pay_rate: number | string;
  charge_rate: number | string;
}

/** A booking that still ties a worker to the shift (§3.6). */
export const LIVE_BOOKING_STATUSES = ['invited', 'confirmed', 'applied', 'worked'] as const;

/**
 * The bookings that keep a role section in the builder (ADR-0160): someone
 * confirmed, or past it. A pending invitation or application does not —
 * remove_shift_sections() tells those workers and the section goes.
 */
export const HELD_BOOKING_STATUSES = ['confirmed', 'worked', 'turned_away'] as const;

/**
 * Reads a Europe/London wall-clock "HH:MM" back out of a stored timestamptz.
 * A VALUE for the draft and `ukRoleWindow`, not a label: always the 24-hour
 * form whatever clock the operator reads (ADR-0085); `TimeField` and the
 * views write it on theirs.
 */
function ukTime(iso: string): string {
  return formatTimeIn(new Date(iso), UK_ZONE);
}

export async function loadEvent(id: string): Promise<SavedEvent | null> {
  if (!supabaseConfigured()) return null;

  const supabase = eventsDb(await cookies());

  // A failed read throws rather than returning null: null is "no such
  // event" and becomes a 404, which is the wrong answer to a DB error — and
  // zero booking counts would let the builder offer to delete a staffed
  // section.
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, client_id, venue_id, title, event_date, po_number, onsite_contact, notes, auto_assign, required_languages, security_cleared, cancelled_at, series_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`The event could not be read: ${error.message}`);
  const event = data as EventRow | null;
  if (!event) return null;

  const [{ data: sectionData, error: sectionError }, { data: rateData, error: rateError }] =
    await Promise.all([
      supabase
        .from('shift_requirements')
        .select(
          'id, role_id, starts_at, ends_at, headcount, buffer, dress_code, auto_assign, required_gender, same_staff_all_days, allocation_per_hour',
        )
        .eq('event_id', id)
        .order('starts_at'),
      supabase.from('shift_rates_v').select('shift_id, pay_rate, charge_rate').eq('event_id', id),
    ]);
  const readError = sectionError ?? rateError;
  if (readError) throw new Error(`The event could not be read: ${readError.message}`);
  const sections = (sectionData ?? []) as SectionRow[];
  const rates = new Map(((rateData ?? []) as SectionRateRow[]).map((r) => [r.shift_id, r]));

  const ids = sections.map((s) => s.id);
  const confirmed = new Map<string, number>();
  const booked = new Map<string, number>();
  const held = new Map<string, number>();
  if (ids.length > 0) {
    const { data: bookings, error: bookingError } = await supabase
      .from('bookings')
      .select('shift_id, status')
      .in('shift_id', ids)
      .in('status', LIVE_BOOKING_STATUSES);
    if (bookingError) throw new Error(`The event could not be read: ${bookingError.message}`);
    for (const row of (bookings ?? []) as { shift_id: string; status: string }[]) {
      booked.set(row.shift_id, (booked.get(row.shift_id) ?? 0) + 1);
      if (row.status === 'confirmed') {
        confirmed.set(row.shift_id, (confirmed.get(row.shift_id) ?? 0) + 1);
      }
      if ((HELD_BOOKING_STATUSES as readonly string[]).includes(row.status)) {
        held.set(row.shift_id, (held.get(row.shift_id) ?? 0) + 1);
      }
    }
  }

  // ADR-0117: the other days of the multi-day job, for "Day 2 of 3". A failed
  // read here only drops that line - it must not fail the whole event.
  const seriesDays: SeriesMember[] = [];
  if (event.series_id) {
    const { data: days } = await supabase
      .from('events')
      .select('id, event_date, cancelled_at')
      .eq('series_id', event.series_id);
    for (const day of (days ?? []) as {
      id: string;
      event_date: string;
      cancelled_at: string | null;
    }[]) {
      seriesDays.push({
        eventId: day.id,
        date: day.event_date,
        cancelled: day.cancelled_at !== null,
      });
    }
  }

  return {
    id: event.id,
    clientId: event.client_id,
    venueId: event.venue_id ?? '',
    title: event.title,
    date: event.event_date,
    poNumber: event.po_number ?? '',
    onsiteContact: event.onsite_contact ?? '',
    notes: event.notes ?? '',
    autoAssign: event.auto_assign,
    requiredLanguages: normaliseLanguages(event.required_languages),
    securityCleared: event.security_cleared === true,
    cancelledAt: event.cancelled_at,
    seriesDays,
    sections: sections.map((s) => ({
      id: s.id,
      roleId: s.role_id,
      start: ukTime(s.starts_at),
      end: ukTime(s.ends_at),
      headcount: s.headcount,
      buffer: s.buffer,
      chargeRate: Number(rates.get(s.id)?.charge_rate ?? 0),
      payRate: Number(rates.get(s.id)?.pay_rate ?? 0),
      dressCode: s.dress_code ?? '',
      autoAssign: s.auto_assign,
      requiredGender: s.required_gender,
      sameStaffAllDays: s.same_staff_all_days,
      allocationPerHour: s.allocation_per_hour,
      confirmed: confirmed.get(s.id) ?? 0,
      booked: booked.get(s.id) ?? 0,
      held: held.get(s.id) ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------
// The events list and calendar (§3.1)
// ---------------------------------------------------------------------

export interface ListedRole {
  roleName: string;
  start: string;
  end: string;
  headcount: number;
  buffer: number;
  confirmed: number;
}

export interface ListedEvent {
  id: string;
  title: string;
  /** The event's own date. Which calendar cell it sits in. */
  date: string;
  /** The Client filter matches on this, never on the name (two clients may share one). */
  clientId: string;
  clientName: string;
  venueName: string;
  venueAddress: string;
  poNumber: string;
  cancelledAt: string | null;
  cancelReason: string;
  roles: ListedRole[];
}

interface ListedEventRow {
  id: string;
  title: string;
  event_date: string;
  venue_name: string;
  venue_address: string;
  po_number: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  client_id: string;
}

/**
 * Every event whose date falls in the period, with the role sections and the
 * confirmed counts the fill chips need (§3.1).
 *
 * Filtered on `event_date`, not on the derived window: an event that runs to
 * 01:00 belongs in the cell of the day it started, which is what the manager
 * looks for it under.
 *
 * A failed query comes back as `problem`, which the page shows in an
 * Alert. It used to be read as "no rows", so a database error rendered as
 * "No events in this period" — a calendar that looked empty on a day with
 * fifteen events on it.
 */
export interface EventsInRange {
  events: ListedEvent[];
  problem: string | null;
}

/** One office_event_sections row (20261019190000). */
interface SectionCount {
  section_id: string;
  event_id: string;
  role_id: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  buffer: number;
  confirmed: number;
}

/** A 42-day Month grid at 15 events a day is ~630 events and ~1,900 sections. */
const LIST_CEILING = 20_000;

export async function loadEventsInRange(from: string, to: string): Promise<EventsInRange> {
  // No project is reported by loadReferenceData's `unavailable`, once.
  if (!supabaseConfigured()) return { events: [], problem: null };

  const supabase = eventsDb(await cookies());

  // Go-live audit B2: the sections and their confirmed counts used to be two
  // more reads after the events — `in.(…)` over every event id, then every
  // section id, past any URL limit on a Month grid, and cut at 1000 rows
  // even when accepted. office_event_sections(from, to) (20261019190000)
  // takes the same period, so it starts with the events instead of after
  // them, and the database does the counting. Both lists are paged past
  // max_rows in a total order; the client and role names are read alongside.
  const [eventRes, sectionRes, clientRes, roleRes] = await Promise.all([
    readAllPages<ListedEventRow>(
      (range) =>
        supabase
          .from('events')
          .select(
            'id, title, event_date, venue_name, venue_address, po_number, cancelled_at, cancel_reason, client_id',
          )
          .gte('event_date', from)
          .lte('event_date', to)
          .order('event_date')
          .order('id')
          .range(range.from, range.to),
      { what: 'events', key: (row) => row.id, ceiling: LIST_CEILING },
    ),
    readAllPages<SectionCount>(
      (range) =>
        supabase
          .rpc('office_event_sections', { p_from: from, p_to: to })
          .range(range.from, range.to),
      { what: 'role sections', key: (row) => row.section_id, ceiling: LIST_CEILING },
    ),
    supabase.from('clients').select('id, name'),
    supabase.from('roles').select('id, name'),
  ]);
  if (eventRes.error) {
    return { events: [], problem: readProblem(eventRes.error, 'Events could not be loaded') };
  }
  const events = eventRes.data;
  if (events.length === 0) return { events: [], problem: null };

  // Without the counts every fill chip would read "0 confirmed".
  const listError = sectionRes.error ?? clientRes.error ?? roleRes.error;
  if (listError) {
    return { events: [], problem: readProblem(listError, 'Events could not be loaded') };
  }

  // Fill counts ONLY confirmed: the function counts status = 'confirmed',
  // exactly what this screen counted itself before.
  const sections = (sectionRes.data ?? []).map((s) => ({
    id: s.section_id,
    event_id: s.event_id,
    role_id: s.role_id,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    headcount: s.headcount,
    buffer: s.buffer,
  }));
  const confirmed = new Map<string, number>(
    (sectionRes.data ?? []).map((s) => [s.section_id, Number(s.confirmed) || 0]),
  );

  const clientNames = new Map(
    ((clientRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const roleNames = new Map(
    ((roleRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
  );

  const byEvent = new Map<string, ListedRole[]>();
  for (const section of sections) {
    const list = byEvent.get(section.event_id) ?? [];
    list.push({
      roleName: roleNames.get(section.role_id) ?? 'Role',
      start: ukTime(section.starts_at),
      end: ukTime(section.ends_at),
      headcount: section.headcount,
      buffer: section.buffer,
      confirmed: confirmed.get(section.id) ?? 0,
    });
    byEvent.set(section.event_id, list);
  }

  const listed = events.map((event) => ({
    id: event.id,
    title: event.title,
    date: event.event_date,
    clientId: event.client_id,
    clientName: clientNames.get(event.client_id) ?? 'Client',
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    poNumber: event.po_number ?? '',
    cancelledAt: event.cancelled_at,
    cancelReason: event.cancel_reason ?? '',
    roles: byEvent.get(event.id) ?? [],
  }));
  return { events: listed, problem: null };
}

/**
 * The busiest day and week ever booked (ADR-0142), for the Week and Day
 * views' "record" flash-up. A failed read is quiet: it only means nothing
 * is celebrated, and the shift totals themselves come from the period.
 */
export async function loadShiftRecords(): Promise<unknown> {
  if (!supabaseConfigured()) return null;
  const supabase = eventsDb(await cookies());
  const { data, error } = await supabase.rpc('scheduling_shift_records');
  return error ? null : data;
}

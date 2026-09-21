import { cookies } from 'next/headers';
import { eventsDb, supabaseConfigured } from './db';

/**
 * Everything the Shift Builder reads — Scope §3.2.
 *
 * Reference data comes from the directories the other bots own: clients
 * (§9.6), venues (§9.11) and roles & rates (§9.10). Nothing here writes.
 * RLS is what protects these rows; the middleware only keeps the wrong role
 * out of the wrong app.
 */

export interface RoleOption {
  id: string;
  name: string;
  /** Base £/h from Roles & rates. Editable per role section on this screen. */
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
  charge_rate: number | string;
  dress_codes: string[] | null;
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
  pay_rate: number | string;
}

export async function loadReferenceData(): Promise<ReferenceData> {
  if (!supabaseConfigured()) {
    return { clients: [], venues: [], roles: [], unavailable: NO_SUPABASE };
  }

  const supabase = eventsDb(await cookies());

  const [clients, rateCards, venues, venueTypes, roles] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, staff_contact_point, contact_emails, pays_breaks, pays_buffer')
      .order('name'),
    supabase.from('client_rate_cards').select('client_id, role_id, charge_rate, dress_codes'),
    supabase
      .from('venues')
      .select('id, name, address, venue_type, geofence_radius_m')
      .is('deleted_at', null)
      .order('name'),
    supabase.from('venue_types').select('key, label'),
    supabase.from('roles').select('id, name, pay_rate').order('name'),
  ]);

  const typeLabels = new Map(
    ((venueTypes.data ?? []) as { key: string; label: string }[]).map((t) => [t.key, t.label]),
  );

  const cardsByClient = new Map<string, ClientOption['rateCard']>();
  for (const card of (rateCards.data ?? []) as RateCardRow[]) {
    const forClient = cardsByClient.get(card.client_id) ?? {};
    forClient[card.role_id] = {
      chargeRate: Number(card.charge_rate),
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
      payRate: Number(r.pay_rate),
    })),
  };
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
  allocationPerHour: number;
  /** Confirmed bookings on THIS role section — who re-confirms if it moves. */
  confirmed: number;
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
  cancelledAt: string | null;
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
  cancelled_at: string | null;
}

interface SectionRow {
  id: string;
  role_id: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  buffer: number;
  charge_rate: number | string;
  pay_rate: number | string;
  dress_code: string | null;
  auto_assign: boolean;
  allocation_per_hour: number;
}

/** Reads a Europe/London wall-clock "HH:MM" back out of a stored timestamptz. */
function ukTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export async function loadEvent(id: string): Promise<SavedEvent | null> {
  if (!supabaseConfigured()) return null;

  const supabase = eventsDb(await cookies());

  const { data } = await supabase
    .from('events')
    .select(
      'id, client_id, venue_id, title, event_date, po_number, onsite_contact, notes, auto_assign, cancelled_at',
    )
    .eq('id', id)
    .maybeSingle();
  const event = data as EventRow | null;
  if (!event) return null;

  const { data: sectionData } = await supabase
    .from('shift_requirements')
    .select(
      'id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate, dress_code, auto_assign, allocation_per_hour',
    )
    .eq('event_id', id)
    .order('starts_at');
  const sections = (sectionData ?? []) as SectionRow[];

  const ids = sections.map((s) => s.id);
  const confirmed = new Map<string, number>();
  if (ids.length > 0) {
    const { data: bookings } = await supabase
      .from('bookings')
      .select('shift_id')
      .eq('status', 'confirmed')
      .in('shift_id', ids);
    for (const booking of (bookings ?? []) as { shift_id: string }[]) {
      confirmed.set(booking.shift_id, (confirmed.get(booking.shift_id) ?? 0) + 1);
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
    cancelledAt: event.cancelled_at,
    sections: sections.map((s) => ({
      id: s.id,
      roleId: s.role_id,
      start: ukTime(s.starts_at),
      end: ukTime(s.ends_at),
      headcount: s.headcount,
      buffer: s.buffer,
      chargeRate: Number(s.charge_rate),
      payRate: Number(s.pay_rate),
      dressCode: s.dress_code ?? '',
      autoAssign: s.auto_assign,
      allocationPerHour: s.allocation_per_hour,
      confirmed: confirmed.get(s.id) ?? 0,
    })),
  };
}

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventsDb, supabaseConfigured } from './db';
import { ROLE_SECTION_MESSAGE, isEditLocked, ukRoleWindow, validateRoleSection } from '@thc/domain';
import { LIVE_BOOKING_STATUSES } from './data';
import { planReconfirmations, reconfirmOutboxRows } from './reconfirm';

/**
 * Saving an event — Scope §3.2, §3.5.
 *
 * The browser disables Save while a section is invalid; this re-checks it,
 * because a disabled button is a courtesy and not a rule. The four-hour floor
 * is checked a third time by the database (`shift_requirements.min_4h`), which
 * is the one that actually holds.
 */

export interface RoleSectionInput {
  id: string | null;
  roleId: string;
  start: string;
  end: string;
  headcount: number;
  buffer: number;
  chargeRate: number;
  payRate: number;
  dressCode: string;
  autoAssign: boolean;
  allocationPerHour: number;
}

export interface EventInput {
  id: string | null;
  clientId: string;
  venueId: string;
  title: string;
  date: string;
  poNumber: string;
  onsiteContact: string;
  notes: string;
  autoAssign: boolean;
  roles: RoleSectionInput[];
}

export type SaveResult = { error: string } | { ok: true; id: string };

const NO_SUPABASE =
  'This environment has no Supabase project, so the event cannot be saved (docs/04-setup-github-vercel-supabase.md).';

function validate(input: EventInput): string | null {
  if (!input.clientId || !input.venueId) return 'Choose a client and a venue.';
  if (!input.title.trim()) return 'Give the event a title.';
  if (!input.date) return 'Set the event date.';
  if (input.roles.length === 0) return 'Add at least one role.';

  for (const role of input.roles) {
    if (!role.roleId) return 'Every role section needs a role.';
    const issues = validateRoleSection({
      ...ukRoleWindow(input.date, role.start, role.end),
      headcount: role.headcount,
      buffer: role.buffer,
      allocationPerHour: role.allocationPerHour,
    });
    if (issues.length > 0) return ROLE_SECTION_MESSAGE[issues[0]!];
  }
  return null;
}

function sectionRow(eventId: string, date: string, role: RoleSectionInput) {
  const { startsAt, endsAt } = ukRoleWindow(date, role.start, role.end);
  return {
    ...(role.id ? { id: role.id } : {}),
    event_id: eventId,
    role_id: role.roleId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    headcount: role.headcount,
    buffer: role.buffer,
    charge_rate: role.chargeRate,
    pay_rate: role.payRate,
    dress_code: role.dressCode || null,
    auto_assign: role.autoAssign,
    allocation_per_hour: role.allocationPerHour,
  };
}

export async function createEvent(input: EventInput): Promise<SaveResult> {
  const invalid = validate(input);
  if (invalid) return { error: invalid };
  if (!supabaseConfigured()) return { error: NO_SUPABASE };

  const supabase = eventsDb(await cookies());

  const [{ data: client }, { data: venue }] = await Promise.all([
    supabase.from('clients').select('pays_breaks, pays_buffer').eq('id', input.clientId).single(),
    supabase
      .from('venues')
      .select('name, address, location, geofence_radius_m')
      .eq('id', input.venueId)
      .single(),
  ]);
  if (!client || !venue) return { error: 'That client or venue no longer exists.' };

  const { data: event, error } = await supabase
    .from('events')
    .insert({
      client_id: input.clientId,
      venue_id: input.venueId,
      // Snapshot, so deleting the venue never rewrites a past event (§9.11).
      // `location` round-trips as the EWKB hex PostgREST hands back.
      venue_name: venue.name,
      venue_address: venue.address,
      venue_location: venue.location,
      geofence_radius_m: venue.geofence_radius_m,
      title: input.title.trim(),
      event_date: input.date,
      notes: input.notes.trim() || null,
      onsite_contact: input.onsiteContact.trim() || null,
      po_number: input.poNumber.trim() || null,
      // Break and Buffer policy are the client's, copied at creation (§3.2).
      pays_breaks: client.pays_breaks,
      pays_buffer: client.pays_buffer,
      auto_assign: input.autoAssign,
    })
    .select('id')
    .single();
  if (error || !event) return { error: error?.message ?? 'The event could not be saved.' };

  const { error: sectionError } = await supabase
    .from('shift_requirements')
    .insert(input.roles.map((role) => sectionRow(event.id, input.date, role)));
  if (sectionError) {
    // An event with no role sections has no window and no status. Roll it back
    // rather than leave one stranded on the calendar.
    await supabase.from('events').delete().eq('id', event.id);
    return { error: sectionError.message };
  }

  revalidatePath('/events');
  redirect(`/events/${event.id}`);
}

export async function updateEvent(input: EventInput): Promise<SaveResult> {
  if (!input.id) return { error: 'This event has not been created yet.' };
  const invalid = validate(input);
  if (invalid) return { error: invalid };
  if (!supabaseConfigured()) return { error: NO_SUPABASE };

  const supabase = eventsDb(await cookies());

  const { data: event } = await supabase
    .from('events')
    .select('event_date, venue_address, cancelled_at')
    .eq('id', input.id)
    .single();
  if (!event) return { error: 'That event no longer exists.' };

  const { data: existing } = await supabase
    .from('shift_requirements')
    .select('id, starts_at, ends_at, dress_code')
    .eq('event_id', input.id);
  const before: ExistingSection[] = existing ?? [];

  // §3.2: editing is allowed only up to the event's start — the same rule the
  // form applies, read from the stored sections rather than from the payload.
  const stored = before.map((s) => ({
    startsAt: new Date(s.starts_at),
    endsAt: new Date(s.ends_at),
  }));
  if (isEditLocked(stored)) {
    return { error: 'This event has started. Editing is locked (§3.2).' };
  }
  if (event.cancelled_at) {
    return { error: 'This event is cancelled and is not edited (§3.2).' };
  }

  const { data: venue } = await supabase
    .from('venues')
    .select('name, address, location, geofence_radius_m')
    .eq('id', input.venueId)
    .single();
  if (!venue) return { error: 'That venue no longer exists.' };

  const { error } = await supabase
    .from('events')
    .update({
      client_id: input.clientId,
      venue_id: input.venueId,
      venue_name: venue.name,
      venue_address: venue.address,
      venue_location: venue.location,
      geofence_radius_m: venue.geofence_radius_m,
      title: input.title.trim(),
      event_date: input.date,
      notes: input.notes.trim() || null,
      onsite_contact: input.onsiteContact.trim() || null,
      po_number: input.poNumber.trim() || null,
      auto_assign: input.autoAssign,
    })
    .eq('id', input.id);
  if (error) return { error: error.message };

  const keep = new Set(input.roles.map((role) => role.id).filter(Boolean) as string[]);
  const removed = before.map((s) => s.id).filter((id) => !keep.has(id));
  if (removed.length > 0) {
    // `bookings.shift_id` cascades on delete, so dropping a section here would
    // destroy its invitations and confirmations outright — no cancelled
    // transition, no cause, no history. §3.6 makes Withdraw the only way a
    // manager takes someone off a shift, so refuse instead (§3.2, §3.3).
    const { data: held } = await supabase
      .from('bookings')
      .select('shift_id')
      .in('shift_id', removed)
      .in('status', LIVE_BOOKING_STATUSES);
    if ((held ?? []).length > 0) {
      return {
        error:
          'A role section with people booked on it cannot be removed. Withdraw them on the event board first (§3.3).',
      };
    }
    await supabase.from('shift_requirements').delete().in('id', removed);
  }

  const { error: sectionError } = await supabase
    .from('shift_requirements')
    .upsert(input.roles.map((role) => sectionRow(input.id!, input.date, role)));
  if (sectionError) return { error: sectionError.message };

  const notifyFailed = await flagReconfirmations(supabase, input, before, {
    dateChanged: event.event_date !== input.date,
    venueChanged: event.venue_address !== venue.address,
    venueBefore: event.venue_address,
  });
  // This path redirects, so there is no result to hang a warning on and the
  // manager cannot be told inline — see docs/14 O14. Logging it is the
  // difference between a failure somebody can find and the silent one this
  // whole change exists to remove. `console.error` is allowed by the lint
  // config and is what `login/actions.ts` already uses for the same reason.
  if (notifyFailed) {
    console.error('[events] N11 could not be queued', { eventId: input.id, error: notifyFailed });
  }

  revalidatePath(`/events/${input.id}`);
  redirect(`/events/${input.id}`);
}

interface ExistingSection {
  id: string;
  starts_at: string;
  ends_at: string;
  dress_code: string | null;
}

/**
 * §3.5. A change to a role's times or dress code sends the workers CONFIRMED
 * ON THAT SECTION back to Awaiting; a venue address change asks everyone on
 * the event. The other sections are untouched and their workers are never
 * asked. Headcount, buffer, charge rate, PO number and notes apply silently,
 * and nobody is auto-removed when headcount drops below the confirmed count
 * (§3.2, §3.3) — the manager withdraws people by hand on the event board.
 *
 * The flag is what the app reads for the Awaiting state, and
 * `reconfirm_reason` is the line the card prints under "Time Changed" —
 * a sentence with the old window, "Start time moved by the office (was
 * 09:00–14:00)" (§3.5), never field names (`reconfirmReason`, D34).
 *
 * The push is N11 when the time moved, and N11b — an extension with its
 * own words — when only the dress code or the venue did: N11's copy says
 * "Shift time changed", which would send a worker to the clock for a
 * change of dress code. Each save that changes something is its own
 * message: the key carries the new start AND end and a per-save marker, so
 * a second end-time change, or a dress-code change after a time change,
 * is not swallowed by the first one's key. A save that changes nothing
 * that matters reaches none of this.
 */
async function flagReconfirmations(
  supabase: SupabaseClient,
  input: EventInput,
  before: ExistingSection[],
  changed: { dateChanged: boolean; venueChanged: boolean; venueBefore: string | null },
): Promise<string | null> {
  const failures: string[] = [];
  const affected = planReconfirmations(input.date, input.roles, before, changed);
  // One marker per save: two saves are two messages, one save is one.
  const saveMarker = new Date().toISOString();

  for (const section of affected) {
    const { data: rows } = await supabase
      .from('bookings')
      .update({ reconfirm_required: true, reconfirm_reason: section.reason })
      .eq('shift_id', section.id)
      .eq('status', 'confirmed')
      .select('id, staff_id');

    const bookings = (rows ?? []) as { id: string; staff_id: string }[];
    if (bookings.length === 0) continue;

    // Through the RPC rather than the table: `notification_outbox` carries
    // only `admin_read`, so a direct insert reaches RLS and is rejected.
    //
    // `payload` is the VALUES map the drain renders the §8 copy with — NOT
    // rendered text (packages/notifications/src/outbox.ts). N11 reads
    // {window}; N11b reads {change}; both deep-link on {bookingId}.
    const { error: queueError } = await supabase.rpc('queue_office_notifications', {
      p_rows: reconfirmOutboxRows(section, bookings, saveMarker),
    });
    // supabase-js returns `{ data, error }` and never throws.
    if (queueError) failures.push(queueError.message);
  }

  return failures.length > 0 ? failures[0]! : null;
}

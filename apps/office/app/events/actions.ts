'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventsDb, supabaseConfigured } from './db';
import {
  type EditableField,
  UK_ZONE,
  formatTimeIn,
  isEditLocked,
  reconfirmingChanges,
  ukRoleWindow,
} from '@thc/domain';
import { TEMPLATES } from '@thc/notifications';
import { LIVE_BOOKING_STATUSES } from './data';
import { EDIT_CLIENT_LOCKED, clientChanged, reconfirmKey, validateEventInput } from './save-rules';

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

/** The pure rules live in `save-rules.ts`, where the tests can reach them. */
const validate = validateEventInput;

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
    .select('event_date, venue_address, cancelled_at, client_id')
    .eq('id', input.id)
    .single();
  if (!event) return { error: 'That event no longer exists.' };
  // §3.2: the client is not on the editable list. The policies copied at
  // creation and the rate-card prices belong to THAT client; the form keeps
  // the select disabled, and this is the rule behind the courtesy.
  if (clientChanged(event.client_id, input.clientId)) return { error: EDIT_CLIENT_LOCKED };

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
 * The flag is what the app reads for the Awaiting state; the push §3.5 pairs
 * with it is N11, queued here in `notification_outbox` with the §8 register's
 * own copy and idempotency key. The key carries the new start, end and dress
 * code, so a second change queues a second push while a re-save of the same
 * values does not.
 * Draining the outbox to Web Push is the sender's job, not this screen's.
 */
async function flagReconfirmations(
  supabase: SupabaseClient,
  input: EventInput,
  before: ExistingSection[],
  changed: { dateChanged: boolean; venueChanged: boolean },
): Promise<string | null> {
  const previous = new Map(before.map((s) => [s.id, s]));
  const failures: string[] = [];
  const affected: {
    id: string;
    reason: string;
    startsAt: Date;
    endsAt: Date;
    dressCode: string | null;
    window: string;
  }[] = [];

  for (const role of input.roles) {
    if (!role.id) continue; // A section added now has nobody booked on it.
    const was = previous.get(role.id);
    if (!was) continue;

    const { startsAt, endsAt } = ukRoleWindow(input.date, role.start, role.end);
    const fields: EditableField[] = [];
    if (startsAt.toISOString() !== new Date(was.starts_at).toISOString()) fields.push('starts_at');
    if (endsAt.toISOString() !== new Date(was.ends_at).toISOString()) fields.push('ends_at');
    if ((role.dressCode || null) !== was.dress_code) fields.push('dress_code');
    if (changed.dateChanged) fields.push('event_date');
    if (changed.venueChanged) fields.push('venue_address');

    const triggers = reconfirmingChanges(fields);
    if (triggers.length > 0) {
      affected.push({
        id: role.id,
        reason: triggers.join(','),
        startsAt,
        endsAt,
        dressCode: role.dressCode || null,
        // The worker is told their ROLE's new hours, never the event window
        // (RULE-18), in UK time as §1.8 has it for a scheduled time.
        window: `${formatTimeIn(startsAt, UK_ZONE)} – ${formatTimeIn(endsAt, UK_ZONE)} (UK)`,
      });
    }
  }

  for (const section of affected) {
    const { data: rows } = await supabase
      .from('bookings')
      .update({ reconfirm_required: true, reconfirm_reason: section.reason })
      .eq('shift_id', section.id)
      .eq('status', 'confirmed')
      .select('id, staff_id');

    const bookings = (rows ?? []) as { id: string; staff_id: string }[];
    if (bookings.length === 0) continue;

    // One call, one row per worker, keyed on what changed (`reconfirmKey`:
    // start, end and dress code) so a re-save of the same values is a no-op
    // against the unique index while a later change to the END alone still
    // queues its push (§8). Through the RPC rather than the table:
    // `notification_outbox` carries only `admin_read`, so a direct insert
    // reaches RLS, finds no INSERT policy and is rejected — which is what
    // this used to do, every time, while N11 reached nobody.
    //
    // `payload` is the VALUES map the drain renders the §8 copy with — NOT
    // rendered text. `render(entry.body, values)` runs in
    // packages/notifications/src/outbox.ts and ignores anything a row calls
    // `body`, so sending pre-rendered copy delivered the literal
    // "Shift time changed — now {window}" to the worker. N11 reads {window}
    // and {bookingId}; `reason` rides along for the card's "was 12:00–00:30".
    const { error: queueError } = await supabase.rpc('queue_office_notifications', {
      p_rows: bookings.map((booking) => ({
        key: reconfirmKey(booking.id, section),
        channel: TEMPLATES.N11.channel,
        template: 'N11',
        recipient_staff_id: booking.staff_id,
        payload: {
          window: section.window,
          bookingId: booking.id,
          reason: section.reason,
        },
      })),
    });
    // supabase-js returns `{ data, error }` and never throws. The unchecked
    // await is how this failed silently for every save until now.
    if (queueError) failures.push(queueError.message);
  }

  return failures.length > 0 ? failures[0]! : null;
}

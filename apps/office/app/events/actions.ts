'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventsDb, supabaseConfigured } from './db';
import {
  ROLE_SECTION_MESSAGE,
  isEditLocked,
  normaliseLanguages,
  ukRoleWindow,
  ukToday,
  validateRoleSection,
} from '@thc/domain';
import { pastDateIssue } from './draft';
import { HELD_BOOKING_STATUSES } from './data';
import { planReconfirmations, reconfirmOutboxRows } from './reconfirm';
import { explainDbError } from '../_lib/dbError';
import { BULK_CONCURRENCY, mapPool } from '../_lib/pool';

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
  /**
   * Null when the builder was opened by an office role without finance
   * (ADR-0061): the rates are then not sent at all, and the database sets
   * the catalogue rates on the section (`shift_rates_office_guard`).
   */
  chargeRate: number | null;
  payRate: number | null;
  dressCode: string;
  autoAssign: boolean;
  /** ADR-0079: book only this gender on the section; null for anyone. */
  requiredGender: 'M' | 'F' | null;
  /** ADR-0117: only people who can do every other day that also asks for it. */
  sameStaffAllDays: boolean;
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
  /** ADR-0080: English plus any language the client asked for. */
  requiredLanguages: string[];
  /**
   * ADR-0117: the event this one was Duplicated from (create only). Saving
   * links the two as days of one multi-day job when the original has a "Same
   * staff on all days" role; the staff are not copied either way.
   */
  duplicateOf?: string | null;
  roles: RoleSectionInput[];
}

export type SaveResult = { error: string } | { ok: true; id: string };

/**
 * Release audit D-M5: the database's refusal as a sentence. The Shift
 * Builder's own rules raise sentences (the 4-hour floor, the edit lock),
 * which are kept; constraint and policy text is not shown.
 */
function refusal(error: {
  code?: string | null;
  message: string;
  details?: string | null;
}): string {
  return explainDbError(error, {
    codes: {
      read_only: 'Your login is read-only, so this cannot be changed.',
      event_started_editing_locked: 'This event has started. Editing is locked.',
      // shift_times_rota_guard: new times re-checked for everyone booked.
      rota_guard_rtw_expired:
        'The new times would put a booked worker past their right-to-work expiry. Withdraw them on the event board first, or keep the times.',
      rota_guard_visa_cap:
        'The new times would take a booked worker over their Student visa weekly limit. Withdraw them on the event board first, or keep the times.',
      rota_guard_wtr_cap:
        'The new times would take a booked worker over the 48-hour weekly limit. Withdraw them on the event board first, or keep the times.',
    },
    check:
      'One of the role sections is not allowed as entered. Check the times, headcount and buffer.',
    generic: 'The event could not be saved. Refresh the page and try again.',
    log: '[events]',
  });
}

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
    event_id: eventId,
    role_id: role.roleId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    headcount: role.headcount,
    buffer: role.buffer,
    ...(role.chargeRate === null ? {} : { charge_rate: role.chargeRate }),
    ...(role.payRate === null ? {} : { pay_rate: role.payRate }),
    dress_code: role.dressCode || null,
    auto_assign: role.autoAssign,
    required_gender: role.requiredGender,
    same_staff_all_days: role.sameStaffAllDays,
    allocation_per_hour: role.allocationPerHour,
  };
}

export async function createEvent(input: EventInput): Promise<SaveResult> {
  // The builder refuses it too; this is the same line for any other caller.
  const past = pastDateIssue(input.date, ukToday());
  if (past) return { error: past };
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
      // English is always in it; the database's CHECK holds the same.
      required_languages: normaliseLanguages(input.requiredLanguages),
      // Release audit D-M1: a Duplicate says what it was made from, so the
      // activity log reads "Duplicated event" (20261014093200). created_by
      // is not sent: the database fills it from the session (auth.uid()).
      ...(input.duplicateOf ? { duplicated_from: input.duplicateOf } : {}),
    })
    .select('id')
    .single();
  if (error || !event) return { error: error ? refusal(error) : 'The event could not be saved.' };

  // ADR-0117: a Duplicate of an event that has a "Same staff on all days" role
  // is another day of the same job. Any other Duplicate ("copy last week's
  // event") is just a copy and joins no series. Linked BEFORE the sections
  // and the first auto-assign round, so that round already sees the series.
  // Duplicating into a different client is allowed (it is only a copy of the
  // roles) and is simply not a series.
  if (input.duplicateOf) {
    const { data: flagged, error: flagError } = await supabase
      .from('shift_requirements')
      .select('id')
      .eq('event_id', input.duplicateOf)
      .eq('same_staff_all_days', true)
      .limit(1);
    if (flagError) {
      await supabase.from('events').delete().eq('id', event.id);
      return { error: `The original event could not be read. ${refusal(flagError)}` };
    }
    if ((flagged ?? []).length > 0) {
      const { error: linkError } = await supabase.rpc('link_event_series', {
        p_source: input.duplicateOf,
        p_clone: event.id,
      });
      if (linkError && !linkError.message.includes('series_other_client')) {
        await supabase.from('events').delete().eq('id', event.id);
        return { error: `The days of this job could not be linked. ${refusal(linkError)}` };
      }
    }
  }

  const { error: sectionError } = await supabase
    .from('shift_requirements')
    .insert(input.roles.map((role) => sectionRow(event.id, input.date, role)));
  if (sectionError) {
    // An event with no role sections has no window and no status. Roll it back
    // rather than leave one stranded on the calendar.
    await supabase.from('events').delete().eq('id', event.id);
    return { error: refusal(sectionError) };
  }

  await firstAutoAssignRound(supabase, event.id);

  revalidatePath('/events');
  redirect(`/events/${event.id}`);
}

/**
 * §3.4: "from the moment the event is created it adds allocation invites
 * every hour". The hourly cron fires at :17, so without this an event saved
 * at 09:20 waited until 10:17 for its first invitations.
 * `auto_assign_first_round()` (20260928110200) posts one hourly-mode round
 * for this event's due sections — both switches on, not started, short of
 * headcount + buffer — to the auto-staffing Edge Function, exactly as the
 * cron command does. It reports rather than raises when nothing is due
 * (auto-assign off) or the base URL / key is not configured, and a failure
 * here must not fail a save that has already happened: the :17 round
 * catches up either way, so the outcome is deliberately not surfaced.
 */
async function firstAutoAssignRound(supabase: SupabaseClient, eventId: string): Promise<void> {
  try {
    await supabase.rpc('auto_assign_first_round', { p_event: eventId });
  } catch {
    // The event is saved; the hourly round will invite at :17.
  }
}

const HAS_PEOPLE =
  'A role section with people confirmed on it cannot be removed. To take the whole event off the schedule use Cancel event on the event board; to drop only this role, withdraw its confirmed people there first.';

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
    return { error: 'This event has started. Editing is locked.' };
  }
  if (event.cancelled_at) {
    return { error: 'This event is cancelled and is not edited.' };
  }

  const { data: venue } = await supabase
    .from('venues')
    .select('name, address, location, geofence_radius_m')
    .eq('id', input.venueId)
    .single();
  if (!venue) return { error: 'That venue no longer exists.' };

  const keep = new Set(input.roles.map((role) => role.id).filter(Boolean) as string[]);
  const removed = before.map((s) => s.id).filter((id) => !keep.has(id));
  if (removed.length > 0) {
    // `bookings.shift_id` cascades on delete, so a section is never removed
    // with anyone confirmed on it: §3.6 makes Withdraw the only way a manager
    // takes someone off a shift (§3.2, §3.3). Pending invitations and
    // applications do not hold it — remove_shift_sections() tells those
    // workers (ADR-0160). Checked before anything is written, so a refusal
    // leaves the event as it was; the RPC checks again under the lock.
    const { data: held } = await supabase
      .from('bookings')
      .select('shift_id')
      .in('shift_id', removed)
      .in('status', HELD_BOOKING_STATUSES);
    if ((held ?? []).length > 0) return { error: HAS_PEOPLE };
  }

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
      // ADR-0080: not under the §3.2 lock, and nobody booked is re-asked.
      required_languages: normaliseLanguages(input.requiredLanguages),
    })
    .eq('id', input.id);
  if (error) return { error: refusal(error) };

  if (removed.length > 0) {
    // One transaction (ADR-0160): re-checks nobody is confirmed under the
    // section lock, tells each pending invitee (N10d) and applicant (N10e),
    // and deletes the sections.
    const { data: removal, error: removeError } = await supabase.rpc('remove_shift_sections', {
      p_event: input.id,
      p_shifts: removed,
    });
    if (removeError) return { error: refusal(removeError) };
    if ((removal as { ok?: boolean } | null)?.ok === false) return { error: HAS_PEOPLE };
  }

  // Existing sections are UPDATEd and new ones INSERTed, not upserted: an
  // upsert's ON CONFLICT … SET pay_rate = EXCLUDED.pay_rate reads the rate
  // column, which no signed-in session may select since ADR-0061 — a
  // manager's save would be refused. A plain UPDATE writes it without
  // reading it.
  const eventId = input.id;
  const storedIds = new Set(before.map((s) => s.id));
  // One UPDATE per stored section, a few at a time rather than one after
  // another (go-live audit M5): each is its own row, refused or saved on its
  // own. The first refusal starts nothing new and is the one reported, in
  // the builder's order.
  const kept = input.roles.filter((role) => role.id && storedIds.has(role.id));
  const updates = await mapPool(
    kept,
    BULK_CONCURRENCY,
    async (role) =>
      (
        await supabase
          .from('shift_requirements')
          .update(sectionRow(eventId, input.date, role))
          .eq('id', role.id!)
          .eq('event_id', eventId)
      ).error,
    (updateError) => Boolean(updateError),
  );
  const updateError = updates.find(Boolean);
  if (updateError) return { error: refusal(updateError) };
  // A section with no stored row — new in the builder, or one that
  // disappeared under it — is inserted, as the upsert used to.
  const added = input.roles.filter((role) => !role.id || !storedIds.has(role.id));
  if (added.length > 0) {
    const { error: insertError } = await supabase
      .from('shift_requirements')
      .insert(added.map((role) => sectionRow(eventId, input.date, role)));
    if (insertError) return { error: refusal(insertError) };
  }

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

  // Each section is its own flag-and-queue, independent of the others, so
  // they run a few at a time (go-live audit M5); every section is still
  // flagged whatever another one's queueing did, as before.
  const outcomes = await mapPool(affected, BULK_CONCURRENCY, async (section) => {
    const { data: rows } = await supabase
      .from('bookings')
      .update({ reconfirm_required: true, reconfirm_reason: section.reason })
      .eq('shift_id', section.id)
      .eq('status', 'confirmed')
      .select('id, staff_id');

    const bookings = (rows ?? []) as { id: string; staff_id: string }[];
    if (bookings.length === 0) return null;

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
    return queueError ? queueError.message : null;
  });
  for (const failure of outcomes) if (failure) failures.push(failure);

  return failures.length > 0 ? failures[0]! : null;
}

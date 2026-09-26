import {
  type EditableField,
  UK_ZONE,
  formatTimeIn,
  reconfirmMovesTime,
  reconfirmReason,
  reconfirmingChanges,
  ukRoleWindow,
} from '@thc/domain';
import { TEMPLATES, outboxKey } from '@thc/notifications';

/**
 * Who re-confirms after an event save, and what they are told — Scope §3.5.
 * Pure, so the rules are tested without a database (reconfirm.test.ts); the
 * save action (`actions.ts`) only writes what this returns.
 *
 *   * A change to a ROLE's start or end, the event date, the venue address
 *     or the role's dress code sends that role's confirmed workers back to
 *     Awaiting. Headcount, buffer, charge, PO and notes are silent (§3.2).
 *   * `reason` is the sentence the card prints under "Time Changed", with
 *     the old window — never field names (D34).
 *   * The push is N11 when the time moved and N11b when only the dress
 *     code or the venue did (N11's copy says the time changed).
 *   * Every save that changes something is its own message: the key holds
 *     the new start and end AND a per-save marker. The old key held the
 *     start only, so a second end-time change — or a dress-code change —
 *     reached nobody.
 */

export interface SavedRole {
  id: string | null;
  start: string;
  end: string;
  dressCode: string;
}

export interface StoredSection {
  id: string;
  starts_at: string;
  ends_at: string;
  dress_code: string | null;
}

export interface ReconfirmSection {
  id: string;
  reason: string;
  code: 'N11' | 'N11b';
  startsAt: Date;
  endsAt: Date;
  /** The ROLE's new hours in UK time (RULE-18, §1.8): "17:00 – 23:30 (UK)". */
  window: string;
}

export function planReconfirmations(
  date: string,
  roles: readonly SavedRole[],
  before: readonly StoredSection[],
  changed: { dateChanged: boolean; venueChanged: boolean; venueBefore: string | null },
): ReconfirmSection[] {
  const previous = new Map(before.map((s) => [s.id, s]));
  const out: ReconfirmSection[] = [];
  for (const role of roles) {
    if (!role.id) continue; // A section added now has nobody booked on it.
    const was = previous.get(role.id);
    if (!was) continue;

    const { startsAt, endsAt } = ukRoleWindow(date, role.start, role.end);
    const fields: EditableField[] = [];
    if (startsAt.getTime() !== new Date(was.starts_at).getTime()) fields.push('starts_at');
    if (endsAt.getTime() !== new Date(was.ends_at).getTime()) fields.push('ends_at');
    if ((role.dressCode || null) !== was.dress_code) fields.push('dress_code');
    if (changed.dateChanged) fields.push('event_date');
    if (changed.venueChanged) fields.push('venue_address');

    const triggers = reconfirmingChanges(fields);
    if (triggers.length === 0) continue;
    out.push({
      id: role.id,
      reason: reconfirmReason(triggers, {
        startsAt: new Date(was.starts_at),
        endsAt: new Date(was.ends_at),
        dressCode: was.dress_code,
        venueAddress: changed.venueBefore,
      }),
      code: reconfirmMovesTime(triggers) ? 'N11' : 'N11b',
      startsAt,
      endsAt,
      window: `${formatTimeIn(startsAt, UK_ZONE)} – ${formatTimeIn(endsAt, UK_ZONE)} (UK)`,
    });
  }
  return out;
}

export interface OutboxRow {
  key: string;
  channel: string;
  template: string;
  recipient_staff_id: string;
  payload: Record<string, string>;
}

/**
 * One outbox row per re-confirming worker. `payload` is the VALUES map the
 * drain renders the register's copy with, never rendered text: N11 reads
 * {window}, N11b reads {change}, both deep-link on {bookingId}.
 */
export function reconfirmOutboxRows(
  section: ReconfirmSection,
  bookings: readonly { id: string; staff_id: string }[],
  saveMarker: string,
): OutboxRow[] {
  return bookings.map((booking) => ({
    key: outboxKey(
      section.code,
      'booking',
      `${booking.id}:${section.startsAt.toISOString()}:${section.endsAt.toISOString()}`,
      saveMarker,
    ),
    channel: TEMPLATES[section.code].channel,
    template: section.code,
    recipient_staff_id: booking.staff_id,
    payload: {
      window: section.window,
      change: section.reason,
      reason: section.reason,
      bookingId: booking.id,
    },
  }));
}

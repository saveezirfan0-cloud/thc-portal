/**
 * The pure rules behind saving an event — Scope §3.2, §3.5.
 *
 * Kept apart from `actions.ts` because a `'use server'` module may export
 * only async functions, and these are what the tests pin.
 */

import { ROLE_SECTION_MESSAGE, ukRoleWindow, validateRoleSection } from '@thc/domain';
import { outboxKey } from '@thc/notifications';
import type { EventInput } from './actions';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

export const NEEDS_TIMES = 'Every role section needs a start and an end';

/**
 * The server's own check of the payload. The browser disables Save while a
 * section is invalid; this re-checks it, because a disabled button is a
 * courtesy and not a rule. The shape is checked BEFORE the times are
 * resolved: `ukInstant` throws on a blank, and a caller that bypasses the
 * disabled button must get `{ error }` back, not a RangeError.
 */
export function validateEventInput(input: EventInput): string | null {
  if (!input.clientId || !input.venueId) return 'Choose a client and a venue.';
  if (!input.title.trim()) return 'Give the event a title.';
  if (!ISO_DATE.test(input.date)) return 'Set the event date.';
  if (input.roles.length === 0) return 'Add at least one role.';

  for (const role of input.roles) {
    if (!role.roleId) return 'Every role section needs a role.';
    if (!HH_MM.test(role.start) || !HH_MM.test(role.end)) return NEEDS_TIMES;
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

/**
 * §3.2's editable list is "venue, date/time, headcount, buffer, charge rate,
 * dress code, as well as the PO Number" — the client is not on it. The
 * client's Break and Buffer policies were copied onto the event at creation
 * and its rate card priced every section, so a re-clientted event would run
 * one client's terms under another's name.
 */
export const EDIT_CLIENT_LOCKED =
  'The client is set when the event is created and cannot be changed afterwards (§3.2). To run this for another client, create a new event.';

export function clientChanged(storedClientId: string, inputClientId: string): boolean {
  return storedClientId !== inputClientId;
}

/**
 * The N11 outbox key for one booking and one edit (§3.5, §8).
 *
 * `notification_outbox.key` is unique and sent rows are never deleted, so
 * the key has to change with WHAT the worker is being asked to re-confirm:
 * the section's start, its end and its dress code (a venue or date change
 * moves the start). Keyed on the start alone, moving the END a week after
 * the start had moved was a silent no-op and the push never left. A re-save
 * of identical values still collides, which is the point.
 */
export function reconfirmKey(
  bookingId: string,
  section: { startsAt: Date; endsAt: Date; dressCode: string | null },
): string {
  return outboxKey(
    'N11',
    'booking',
    `${bookingId}:${section.startsAt.toISOString()}:${section.endsAt.toISOString()}:${section.dressCode ?? ''}`,
  );
}

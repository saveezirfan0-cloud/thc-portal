/**
 * Event board rules — Scope §3.3.
 *
 * The board is per ROLE SECTION, ordered by start time so it reads like the
 * running order of the day (RULE-18 again: the section's own window, never
 * the event's). What is collected here is the handful of rules that decide
 * what the manager is shown and what they are allowed to press, all of which
 * are easy to get subtly wrong:
 *
 *   - Slot counts are CONFIRMED only. Invited and applied never count.
 *   - Invited and Potential pool are hidden entirely — not shown empty — once
 *     a role is confirmed and stable, and reappear the moment a shortfall
 *     reopens on an event that has already started.
 *   - A no-show stays inside Confirmed with a badge, and is never moved to a
 *     list of its own.
 *   - The manual No-show button opens when the shift starts and closes two
 *     weeks after it ends, so a no-show can still be recorded during the
 *     following week's pay run.
 *   - Neither No-show nor Get back ever corrects a payroll run that has
 *     already gone to finance; both warn instead.
 */

import type { EventStatus } from './events';

const DAY_MS = 86_400_000;

export interface RoleBoardCounts {
  /** Confirmed bookings on this section, no-shows included — they still hold the slot. */
  confirmed: number;
  invited: number;
  headcount: number;
  buffer: number;
}

/** Slots still unconfirmed against headcount. Never against headcount + buffer. */
export function openSlots(counts: RoleBoardCounts): number {
  return Math.max(0, counts.headcount - counts.confirmed);
}

/** "9 confirmed · 4 invited · 3 open of 12" — the role section header (§3.3). */
export function roleBoardHeader(counts: RoleBoardCounts): string {
  return `${counts.confirmed} confirmed · ${counts.invited} invited · ${openSlots(counts)} open of ${counts.headcount}`;
}

/**
 * Whether Invited and Potential pool are shown for this role at all (§3.3).
 *
 * They are hidden ENTIRELY — not rendered empty — once the role is confirmed
 * and stable: an Ongoing event with no shortfall, or any Completed or
 * Cancelled event. If a shortfall reopens on an event that is already
 * Ongoing, because someone no-showed or left, they come back so the manager
 * can still fill it.
 */
export function showsCandidatePools(status: EventStatus, counts: RoleBoardCounts): boolean {
  if (status === 'completed' || status === 'cancelled') return false;
  // Upcoming: still filling, so the pools stay even at full confirmation —
  // a drop-out before the day is the ordinary case the buffer exists for.
  if (status === 'upcoming') return true;
  return openSlots(counts) > 0 || counts.invited > 0;
}

/**
 * §3.3. The manual No-show button opens when the shift starts and stays open
 * for two weeks after it ends. Before the start there is nothing to miss;
 * after two weeks the pay-and-bill run it could still have affected is long
 * past.
 */
export const NO_SHOW_WINDOW_DAYS = 14;

export function canMarkNoShow(
  shift: { startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): boolean {
  if (now < shift.startsAt) return false;
  return now.getTime() <= shift.endsAt.getTime() + NO_SHOW_WINDOW_DAYS * DAY_MS;
}

/**
 * The two mirror-image warnings (§3.3). Neither action reverses or tops up a
 * run that has already gone to finance; the money is corrected in THC's own
 * finance process, outside the app. Returning null keeps the caller from
 * inventing a reassuring message when there is nothing to warn about.
 */
export function payrollWarning(
  action: 'no_show' | 'get_back',
  payrollExported: boolean,
): string | null {
  if (!payrollExported) return null;
  return action === 'no_show'
    ? 'This shift has already been included in a payroll export. Marking a No-show now will not reverse the payment — please notify Finance to reverse it.'
    : 'This shift has already been included in a payroll export. This change will not add the payment — please notify Finance to pay it.';
}

/**
 * §3.3. A no-show is not a section: the worker stays in Confirmed, badged,
 * with Get back beside them. This says how to render one, so no caller is
 * tempted to filter them out of the roster.
 */
export interface ConfirmedEntry {
  noShow: boolean;
  /** A booking confirmed after the shift started is exempt from the lock (§5.1). */
  confirmedAfterStart: boolean;
}

export function confirmedBadge(entry: ConfirmedEntry): 'no_show' | null {
  return entry.noShow ? 'no_show' : null;
}

/** Role sections read top to bottom in start order, earliest first (§3.3). */
export function orderSections<T extends { startsAt: Date }>(sections: T[]): T[] {
  return [...sections].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * §3.3 / §3.4. Cancelling an event reaches everyone still attached to it —
 * confirmed, invited, AND anyone with an open Radar application — rather than
 * only the first two, which is the part that was confirmed late and is easy
 * to miss.
 */
export const CANCEL_NOTIFIES = ['confirmed', 'invited', 'applied'] as const;
export type CancelNotifies = (typeof CANCEL_NOTIFIES)[number];

export function isNotifiedOnCancel(status: string): status is CancelNotifies {
  return (CANCEL_NOTIFIES as readonly string[]).includes(status);
}

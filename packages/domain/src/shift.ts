/**
 * Shift Builder rules — Scope §3.2, §3.4, §3.5.
 *
 * An event is a list of ROLE SECTIONS. Every rule about time reads the
 * section's own start and end (RULE-18); the event window is derived from
 * them and exists only for the calendar, the list and the status pill. The
 * four rules this screen gets wrong most often live here:
 *
 *  1. Buffer is absolute and never collapsed into the total — `buffer.ts`.
 *  2. Allocation per hour defaults to headcount + buffer (§3.4).
 *  3. Timing is per role section, never the event window (RULE-18).
 *  4. A section is at least four hours, and the event is edit-locked from
 *     the moment its derived window starts (§3.2).
 *
 * `shift.vectors.json` is the contract between these functions and the DB:
 * `shift_requirements.min_4h` and the `event_windows` view must agree with
 * `validateRoleSection` and `derivedEventWindow` case for case.
 */

import { allocationTarget } from './buffer';
import { HOLIDAY_RATE } from './pay';

/** §3.2. Shifts are 4–8 h, minimum 4 h — a hard validation, per role. */
export const MIN_SHIFT_HOURS = 4;

const MS_PER_HOUR = 3_600_000;

export interface RoleSectionWindow {
  /** The section's own start. Never the event window (RULE-18). */
  startsAt: Date;
  endsAt: Date;
}

export interface RoleSectionDraft extends RoleSectionWindow {
  headcount: number;
  buffer: number;
  /** Invitations auto-assign sends per hourly round (§3.4). */
  allocationPerHour: number;
}

export type RoleSectionIssue =
  | 'end_before_start'
  | 'below_minimum_hours'
  | 'headcount_below_one'
  | 'negative_buffer'
  | 'allocation_below_one';

/** The message the Shift Builder shows against the offending field. */
export const ROLE_SECTION_MESSAGE: Record<RoleSectionIssue, string> = {
  end_before_start: 'End time cannot fall before the start',
  below_minimum_hours: `Minimum shift length is ${MIN_SHIFT_HOURS} hours`,
  headcount_below_one: 'Headcount must be at least 1',
  negative_buffer: 'Buffer cannot be negative',
  allocation_below_one: 'Allocation per hour must be at least 1',
};

/** The section's length in hours — 8, or 6.5 for 17:00–23:30. */
export function sectionHours(window: RoleSectionWindow): number {
  return (window.endsAt.getTime() - window.startsAt.getTime()) / MS_PER_HOUR;
}

/** "8 h" · "6.5 h". Whole hours lose the decimal, as on the role header. */
export function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

/**
 * Everything wrong with one role section, in the order the form reads.
 *
 * An end after midnight is fine — the caller has already resolved 17:00–01:30
 * to two instants a day apart (`ukRoleWindow`). What is rejected is an end
 * that lands before its own start, and any section shorter than four hours.
 */
export function validateRoleSection(draft: RoleSectionDraft): RoleSectionIssue[] {
  const issues: RoleSectionIssue[] = [];
  const hours = sectionHours(draft);

  if (hours < 0) issues.push('end_before_start');
  else if (hours < MIN_SHIFT_HOURS) issues.push('below_minimum_hours');

  if (draft.headcount < 1) issues.push('headcount_below_one');
  if (draft.buffer < 0) issues.push('negative_buffer');
  if (draft.allocationPerHour < 1) issues.push('allocation_below_one');

  return issues;
}

export function isRoleSectionValid(draft: RoleSectionDraft): boolean {
  return validateRoleSection(draft).length === 0;
}

/**
 * §3.4. Allocation per hour defaults to headcount + buffer — the whole
 * confirmation target, not the working headcount — and stays editable.
 */
export function defaultAllocationPerHour(headcount: number, buffer: number): number {
  return allocationTarget(headcount, buffer);
}

/**
 * RULE-18 / §1.5. The event window is DERIVED: earliest role start to latest
 * role end. It drives the calendar, the event list, the Client Portal and the
 * Upcoming / Ongoing / Completed status — and nothing else. No timing rule
 * may read it in place of a section's own hours.
 */
export function derivedEventWindow(sections: RoleSectionWindow[]): RoleSectionWindow | null {
  if (sections.length === 0) return null;
  let startsAt = sections[0]!.startsAt;
  let endsAt = sections[0]!.endsAt;
  for (const section of sections.slice(1)) {
    if (section.startsAt < startsAt) startsAt = section.startsAt;
    if (section.endsAt > endsAt) endsAt = section.endsAt;
  }
  return { startsAt, endsAt };
}

/**
 * §3.2. Editing is allowed only up to the event's start — so once the derived
 * window has started, and therefore for every past event, the builder is
 * read-only. An event with no sections yet cannot have started.
 */
export function isEditLocked(sections: RoleSectionWindow[], now: Date = new Date()): boolean {
  const window = derivedEventWindow(sections);
  return window !== null && now >= window.startsAt;
}

// ---------------------------------------------------------------------
// §3.5 — which edits ask the booked staff to re-confirm
// ---------------------------------------------------------------------

/**
 * Changing these affects the worker's job on the day, so everyone booked on
 * THAT ROLE moves to Awaiting and gets push N11. The other sections are
 * untouched and their workers are never asked.
 */
export const RECONFIRM_FIELDS = [
  'starts_at',
  'ends_at',
  'event_date',
  'venue_address',
  'dress_code',
] as const;

/** These apply silently — no re-confirmation for already-booked staff. */
export const SILENT_FIELDS = [
  'headcount',
  'buffer',
  'charge_rate',
  'pay_rate',
  'po_number',
  'notes',
  'onsite_contact',
  'allocation_per_hour',
  'auto_assign',
  'title',
] as const;

export type ReconfirmField = (typeof RECONFIRM_FIELDS)[number];
export type SilentField = (typeof SILENT_FIELDS)[number];
export type EditableField = ReconfirmField | SilentField;

export function requiresReconfirmation(field: EditableField): field is ReconfirmField {
  return (RECONFIRM_FIELDS as readonly string[]).includes(field);
}

/** Of the fields the manager actually changed, the ones that trigger N11. */
export function reconfirmingChanges(changed: EditableField[]): ReconfirmField[] {
  return changed.filter(requiresReconfirmation);
}

/** What the section looked like before the save — the "was" in the reason. */
export interface ReconfirmBefore {
  startsAt: Date;
  endsAt: Date;
  dressCode: string | null;
  venueAddress: string | null;
}

const UK_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Fri 19 Sep" in Europe/London — spelled out so ICU's "Sept" never leaks in. */
export function ukDayLabel(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${UK_MONTHS[Number(get('month')) - 1] ?? ''}`;
}

function ukClock(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** "09:00–14:00" in UK time — a scheduled window (§1.8). */
export function ukWindowLabel(startsAt: Date, endsAt: Date): string {
  return `${ukClock(startsAt)}–${ukClock(endsAt)}`;
}

/**
 * The line the worker's card shows under "Time Changed" (§3.5): what
 * changed, in the office's words, with the old value — "Start time moved
 * by the office (was 09:00–14:00)". Stored in `bookings.reconfirm_reason`
 * and printed as-is by the Staff App, so it is a sentence, never field
 * names. Times are the ROLE's own (RULE-18), in UK time (§1.8).
 *
 * A date move carries the times with it, so it is reported once, as the
 * date, with the old day and window.
 */
export function reconfirmReason(
  changed: readonly ReconfirmField[],
  before: ReconfirmBefore,
): string {
  const has = (field: ReconfirmField) => changed.includes(field);
  const window = ukWindowLabel(before.startsAt, before.endsAt);
  const lines: string[] = [];

  if (has('event_date')) {
    lines.push(`Date moved by the office (was ${ukDayLabel(before.startsAt)} ${window})`);
  } else if (has('starts_at') && has('ends_at')) {
    lines.push(`Start and end time moved by the office (was ${window})`);
  } else if (has('starts_at')) {
    lines.push(`Start time moved by the office (was ${window})`);
  } else if (has('ends_at')) {
    lines.push(`End time moved by the office (was ${window})`);
  }
  if (has('venue_address')) {
    lines.push(`Venue changed by the office (was ${before.venueAddress?.trim() || 'not set'})`);
  }
  if (has('dress_code')) {
    lines.push(
      `Dress code changed by the office (was ${before.dressCode?.trim() || 'not specified'})`,
    );
  }
  return lines.join(' · ');
}

/** Whether a set of changes moved the role's time — N11 — or only its details. */
export function reconfirmMovesTime(changed: readonly ReconfirmField[]): boolean {
  return changed.some((f) => f === 'starts_at' || f === 'ends_at' || f === 'event_date');
}

// ---------------------------------------------------------------------
// Forecast — the sticky summary panel
// ---------------------------------------------------------------------

/**
 * The advertised hourly rate: base plus holiday at 12.07%, broken out and
 * never blended (§9.8). Mirrors the SQL `final_rate(base)`.
 */
export function finalHourlyPence(basePence: number): number {
  return Math.round(basePence * (1 + HOLIDAY_RATE));
}

/** Charge minus the final hourly rate — the "+£9.40/h" on a role header. */
export function marginPerHourPence(chargePence: number, basePayPence: number): number {
  return chargePence - finalHourlyPence(basePayPence);
}

export interface ForecastSection extends RoleSectionWindow {
  headcount: number;
  chargeRatePence: number;
  payRatePence: number;
}

export interface Forecast {
  /** Headcount × hours. The buffer is THC's cover, so it is not forecast. */
  payableHours: number;
  chargePence: number;
  basePayPence: number;
  holidayPence: number;
  marginPence: number;
  /** Margin over charge. Zero charge reads as 0 rather than NaN. */
  marginPct: number;
}

/**
 * What the event is worth if everyone works their scheduled hours.
 *
 * Forecast on HEADCOUNT, not headcount + buffer: the client is charged for
 * the people it asked for, and the buffer is insurance THC carries (§3.2).
 * Holiday pay is a separate line, never folded into the base (§9.8).
 */
export function forecastEvent(sections: ForecastSection[]): Forecast {
  let payableHours = 0;
  let chargePence = 0;
  let basePayPence = 0;

  for (const section of sections) {
    const hours = sectionHours(section) * section.headcount;
    payableHours += hours;
    chargePence += hours * section.chargeRatePence;
    basePayPence += hours * section.payRatePence;
  }

  chargePence = Math.round(chargePence);
  basePayPence = Math.round(basePayPence);
  const holidayPence = Math.round(basePayPence * HOLIDAY_RATE);
  const marginPence = chargePence - basePayPence - holidayPence;

  return {
    payableHours,
    chargePence,
    basePayPence,
    holidayPence,
    marginPence,
    marginPct: chargePence === 0 ? 0 : (marginPence / chargePence) * 100,
  };
}

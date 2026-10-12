/**
 * "Same staff on all days" — ADR-0116, a deliberate change to Scope §3.2.
 *
 * §3.2 says "Multi-day = separate events created via Duplicate (the clone
 * copies the roles, NOT the staff)". That still holds: nobody is copied. What
 * is new is a REQUIREMENT a manager can put on a role section, which narrows
 * who may be invited to it:
 *
 *   An event's days are linked by `events.series_id` (set on both the source
 *   and the clone when Duplicate is used). A role section with
 *   `same_staff_all_days` on may be offered only to a worker who passes the
 *   hard gates for EVERY sibling section — the same role, in another event of
 *   the same series, with the flag also on — and whose hours, projected over
 *   all of those days together, stay inside their weekly cap (RULE-20).
 *
 * The SQL twin is in supabase/migrations/20261012140000_same_staff_all_days.sql:
 * `series_siblings()`, `series_hours_blocked()`, and the gate itself twice over
 * - `series_gate_for()` for ONE worker (invite, Accept, apply, take, Radar:
 * one pool row, never a sibling pool, because authenticated has an 8 s
 * statement timeout) and `auto_assign_candidates()` for a LIST (the board and
 * the rounds), a wrapper over `auto_assign_candidates_pool()`. The refusal it
 * gives is the gate named below, so the pool, `invite_worker`, Radar and
 * Accept all say the same thing; pgTAP 804 holds the SQL to the scenarios in
 * `series.vectors.json`, which this module's tests run too.
 *
 * What is NOT here, because the client has not answered yet (ADR-0116,
 * PROVISIONAL): one Accept booking every day, cancelling one day cascading to
 * the others, the worker being told "all 3 days", and a per-event switch.
 */
import { capWeekStart } from './cap';
import { type RotaGuardInput, type RotaGuardMode, rotaGuardVerdict } from './rotaGuard';

/**
 * The gate (and `invite_worker` refusal) for a worker who cannot do every
 * day. One name for all the ways a sibling day can fail — the board's
 * Unavailable section says why in words.
 */
export const NOT_AVAILABLE_ALL_DAYS = 'not_available_all_days' as const;

/** How far apart two days of one series may start (ADR-0116). */
export const SERIES_WINDOW_DAYS = 14;

/** The switch's label on the role section, and the chip on the board. */
export const SERIES_LABEL = 'Same staff on all days';

/** A role section, as the series rule needs to see it. */
export interface SeriesSection {
  shiftId: string;
  eventId: string;
  /** `events.series_id`; null = a single-day event, which has no siblings. */
  seriesId: string | null;
  roleId: string;
  sameStaffAllDays: boolean;
  eventCancelled: boolean;
  startsAt: Date;
  endsAt: Date;
  /** Europe/London calendar day the section starts on, `YYYY-MM-DD`. */
  startsOn: string;
  hours: number;
}

/**
 * The sections a flagged section must also be fillable on. Mirrors
 * `series_siblings(p_shift)`:
 *
 *   - nothing unless `self` is itself flagged and in a series;
 *   - another event of the SAME series (never the event's own other sections);
 *   - the SAME role, with the flag ALSO on — a day that does not ask for the
 *     same staff does not constrain this one;
 *   - starting within SERIES_WINDOW_DAYS of this section: a series is a run of
 *     days, not a standing arrangement ("copy last week's event" x20 is not
 *     one job);
 *   - not a cancelled event, and not a day that has already ended (a past day
 *     cannot be rostered; whatever the worker really booked there is already
 *     in their week as a booking).
 */
export function seriesSiblings(
  self: SeriesSection,
  others: readonly SeriesSection[],
  now: Date = new Date(),
): SeriesSection[] {
  if (!self.sameStaffAllDays || self.seriesId === null) return [];
  return others.filter(
    (o) =>
      o.shiftId !== self.shiftId &&
      o.eventId !== self.eventId &&
      o.seriesId === self.seriesId &&
      o.roleId === self.roleId &&
      o.sameStaffAllDays &&
      !o.eventCancelled &&
      o.endsAt.getTime() > now.getTime() &&
      Math.abs(o.startsAt.getTime() - self.startsAt.getTime()) <= SERIES_WINDOW_DAYS * 86_400_000,
  );
}

/** One day of the series as the projection sees it. */
export interface SeriesDay {
  /** Europe/London calendar day the section starts on, `YYYY-MM-DD`. */
  startsOn: string;
  hours: number;
  /** `canRoster()` for the section's start AND end day. */
  canRoster: boolean;
}

/** The series' hours in one Mon–Sun cap week. */
export interface SeriesWeek {
  /** Monday, `YYYY-MM-DD`. */
  weekStart: string;
  /** The earliest series day in the week — the date the cap is read for. */
  firstDay: string;
  hours: number;
  canRoster: boolean;
}

/**
 * Groups the series' days by the Mon–Sun week each STARTS in (Europe/London),
 * the bucket `weekly_booked_hours()` uses, summing the hours. Mirrors the
 * `wk` CTE in `series_hours_blocked()`. Sorted by week.
 */
export function projectSeriesWeeks(days: readonly SeriesDay[]): SeriesWeek[] {
  const weeks = new Map<string, SeriesWeek>();
  for (const day of days) {
    const weekStart = capWeekStart(day.startsOn);
    const week = weeks.get(weekStart);
    if (!week) {
      weeks.set(weekStart, {
        weekStart,
        firstDay: day.startsOn,
        hours: day.hours,
        canRoster: day.canRoster,
      });
    } else {
      week.hours += day.hours;
      week.canRoster = week.canRoster && day.canRoster;
      if (day.startsOn < week.firstDay) week.firstDay = day.startsOn;
    }
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** What the caller knows of one projected week besides the series itself. */
export interface SeriesWeekContext {
  /** The worker's cap for that week; null is no ceiling. */
  capHours: number | null;
  band: RotaGuardInput['band'];
  /**
   * Hours already committed in the week by bookings that are NOT part of
   * this series. The series' own days are excluded and counted as projected
   * instead, so a day the worker already holds is not counted twice.
   */
  bookedHours: number;
}

/**
 * True when ANY week's projected hours — every series day in it together —
 * would be blocked by the rota guard (RULE-20): a right-to-work stop, a
 * Student visa band, or a Working Time 48 while the guard is in block mode.
 * A `warn` verdict does not block, exactly as `weekly_cap_would_breach()`.
 *
 * Three 8 h days in one Student-visa term week (cap 20) is blocked; one 8 h
 * day a week for three weeks is not.
 */
export function seriesHoursBlocked(
  weeks: readonly SeriesWeek[],
  contextFor: (week: SeriesWeek) => SeriesWeekContext,
  mode: RotaGuardMode = 'block',
): boolean {
  return weeks.some((week) => {
    const ctx = contextFor(week);
    return (
      rotaGuardVerdict({
        canRoster: week.canRoster,
        capHours: ctx.capHours,
        band: ctx.band,
        bookedHours: ctx.bookedHours,
        shiftHours: week.hours,
        mode,
      }).verdict === 'block'
    );
  });
}

/** The facts about one worker against one flagged section's series. */
export interface SeriesGateInput {
  /**
   * The pool gate (`auto_assign_candidates_pool`) the worker has on each
   * sibling section; null for none. One entry per sibling.
   */
  siblingGates: readonly (string | null)[];
  /** The worker marked themselves unavailable during any sibling's window. */
  unavailableOnASibling: boolean;
  /** `seriesHoursBlocked()` over the series. */
  hoursBlocked: boolean;
}

/**
 * The series gate itself: `not_available_all_days` when any sibling day
 * would refuse the worker, null otherwise. Applied AFTER the section's own
 * gates, so a worker who is also blocked or on the wrong role is refused for
 * that truer reason.
 */
export function seriesGate(input: SeriesGateInput): typeof NOT_AVAILABLE_ALL_DAYS | null {
  if (input.siblingGates.some((g) => g !== null)) return NOT_AVAILABLE_ALL_DAYS;
  if (input.unavailableOnASibling || input.hoursBlocked) return NOT_AVAILABLE_ALL_DAYS;
  return null;
}

// ---------------------------------------------------------------------
// "Day 2 of 3" — the context line on the event header and board
// ---------------------------------------------------------------------

/** One event of a series, for numbering the days. */
export interface SeriesMember {
  eventId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  cancelled: boolean;
}

export interface SeriesPosition {
  day: number;
  of: number;
}

/**
 * Where an event sits among the live days of its series, by date. Null when
 * there is nothing to say: the event stands alone, or is not in the list.
 * A cancelled day is not a day any more — it neither counts nor is numbered
 * (the event itself shows nothing when it is the cancelled one).
 */
export function seriesPosition(
  eventId: string,
  members: readonly SeriesMember[],
): SeriesPosition | null {
  const live = members
    .filter((m) => !m.cancelled)
    .sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId));
  const index = live.findIndex((m) => m.eventId === eventId);
  if (index === -1 || live.length < 2) return null;
  return { day: index + 1, of: live.length };
}

/** "Day 2 of 3". */
export function seriesPositionLabel(position: SeriesPosition): string {
  return `Day ${position.day} of ${position.of}`;
}

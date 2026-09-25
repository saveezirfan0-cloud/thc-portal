/**
 * Event status and fill — Scope §1.5, §3.1, §3.3.
 *
 * Both are DERIVED. Only `cancelled` is stored; Upcoming / Ongoing / Completed
 * come from the event's own window, which is itself derived from the role
 * sections (RULE-18, `derivedEventWindow`). The same three values drive the
 * status pill on the list, the calendar and the Client Portal, so they are
 * computed here once rather than in each screen.
 *
 * Fill counts CONFIRMED bookings against HEADCOUNT, never against headcount +
 * buffer: the buffer is THC's cover, not something the client asked for. A
 * role that has confirmed more than its headcount is full, and the surplus is
 * reported separately as buffer rather than inflating the count (§3.2).
 */

import type { RoleSectionWindow } from './shift';

export type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

/**
 * §1.5. Mirrors the SQL `event_status(e, window_start, window_end)`: cancelled
 * wins outright, then the window decides. An event with no role sections yet
 * has no window and reads as Upcoming.
 */
export function eventStatus(
  window: RoleSectionWindow | null,
  cancelledAt: Date | string | null,
  now: Date = new Date(),
): EventStatus {
  if (cancelledAt) return 'cancelled';
  if (!window) return 'upcoming';
  if (now < window.startsAt) return 'upcoming';
  return now <= window.endsAt ? 'ongoing' : 'completed';
}

/**
 * §3.3 Cancel event, and its resolved edge case: a cancellation BEFORE the
 * day of the event is excluded from the financial reports; one on the day
 * (or after it) bills the scheduled hours to the client in full and pays
 * every affected worker their scheduled hours. "The day" is the event date
 * in Europe/London (§1.8) — the rule the payroll export and the dashboard
 * already apply (`uk_local(cancelled_at)::date >= event_date`,
 * 20260923130000, 20260927160700).
 */
export function cancelledOnTheDay(cancelledAt: Date | string, eventDate: string): boolean {
  const at = typeof cancelledAt === 'string' ? new Date(cancelledAt) : cancelledAt;
  // en-CA formats as YYYY-MM-DD, which compares as a string.
  const ukDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return ukDay >= eventDate;
}

/** The finance line for a cancelled event, for the list and the board (§3.3, §9.9). */
export function cancelledFinanceNote(cancelledAt: Date | string, eventDate: string): string {
  return cancelledOnTheDay(cancelledAt, eventDate)
    ? 'cancelled on the day — scheduled hours billed and paid'
    : 'excluded from financials';
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export interface FillableSection {
  headcount: number;
  buffer: number;
  /** Confirmed bookings on this section. Invited and applied never count. */
  confirmed: number;
}

export interface EventFill {
  /** Confirmed, capped at headcount — what "13 of 17" reports. */
  confirmed: number;
  headcount: number;
  buffer: number;
  /** Headcount still unconfirmed. Zero once the event is full. */
  open: number;
  /**
   * Confirmations beyond headcount, i.e. buffer seats taken. Reported apart
   * from the fill so the count never reads as more than the client asked for.
   */
  bufferConfirmed: number;
}

/** Totals across an event's role sections (§3.1, §3.3). */
export function eventFill(sections: FillableSection[]): EventFill {
  let confirmed = 0;
  let headcount = 0;
  let buffer = 0;
  let bufferConfirmed = 0;

  for (const section of sections) {
    headcount += section.headcount;
    buffer += section.buffer;
    // Per SECTION, so a role over-confirmed cannot paper over another short.
    confirmed += Math.min(section.confirmed, section.headcount);
    bufferConfirmed += Math.max(0, section.confirmed - section.headcount);
  }

  return { confirmed, headcount, buffer, open: headcount - confirmed, bufferConfirmed };
}

/** "13 of 17" — confirmed against headcount, never against the total seats. */
export function formatEventFill(fill: EventFill): string {
  return `${fill.confirmed} of ${fill.headcount}`;
}

export function isEventFull(fill: EventFill): boolean {
  return fill.open === 0;
}

/** "4 open", or null once nothing is short. */
export function formatOpen(fill: EventFill): string | null {
  return fill.open > 0 ? `${fill.open} open` : null;
}

/** "13 ev · 45 open" — the daily and monthly counters on §3.1. */
export function formatCounter(events: number, open: number): string {
  return `${events} ev · ${open} open`;
}

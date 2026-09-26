import { ukToday } from '@thc/domain';

/**
 * "Invited 2 h ago" / "Invited yesterday" — the Invites card's pill
 * (`wireframes/staff/invites.html`).
 *
 * Invitations do not expire and the slot goes to the first to confirm
 * (§10.4), so how long one has been sitting there is the most useful thing
 * the pill can say: an invitation from this morning is likely still open,
 * one from last week likely is not.
 *
 * Under an hour counts minutes; the rest of the same UK day counts hours;
 * then "yesterday" and a count of days by the UK calendar, and past a week
 * the date itself. The calendar is the UK's because the worker's "today"
 * elsewhere is the same UK working day (§1.8); relative time needs no zone
 * label.
 */
export function invitedAgo(invitedAt: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - invitedAt.getTime()) / 60_000);
  if (minutes < 1) return 'Invited just now';
  if (minutes < 60) return `Invited ${minutes} min ago`;

  const days = calendarDaysBetween(invitedAt, now);
  if (days <= 0) return `Invited ${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return 'Invited yesterday';
  if (days < 7) return `Invited ${days} days ago`;
  // The wireframes' "12 Sep", spelled out rather than left to the ICU build,
  // some of which write "Sept".
  const [, month, day] = ukToday(invitedAt).split('-').map(Number);
  return `Invited ${day} ${MONTHS[(month ?? 1) - 1]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Whole UK calendar days from `a` to `b`. */
function calendarDaysBetween(a: Date, b: Date): number {
  const day = (d: Date) => Date.parse(`${ukToday(d)}T00:00:00Z`);
  return Math.round((day(b) - day(a)) / 86_400_000);
}

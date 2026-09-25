import { UK_ZONE, formatDateIn } from '@thc/domain';

/**
 * When a worked shift is paid — the rule behind Earnings history (§10.1).
 *
 * §10.1 wants "a card per completed, PAID shift", and the empty state says
 * what paid means: "Your first paid shift will appear here after the Friday
 * it's paid. You're paid the Friday after the week you worked."
 *
 * So the pay date is derived, never stored: the Friday of the week AFTER
 * the Monday-Sunday week the shift ended in. The wireframe's own three
 * cards are the vectors — Sat 5 Sep and Wed 2 Sep 2026 both pay on Fri 11
 * Sep, Sat 29 Aug pays on Fri 4 Sep — and they are asserted in the tests.
 *
 * Europe/London decides the week, as every rule in this product does
 * (§1.8). A shift ending at 00:30 BST on a Monday belongs to the week that
 * Monday starts, not to the one the UTC instant falls in, and the two are
 * different weeks for exactly the shifts a worker is most likely to query.
 *
 * `staff_earnings()` computes the same date in SQL. Two copies is one more
 * than ideal, but the alternative is either a round trip to filter a list
 * the server already has or a rule the screen cannot explain; the tests
 * below pin both to the same examples.
 */

const UK_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date an instant falls on in the UK, as `YYYY-MM-DD`. */
export function ukDate(instant: Date): string {
  const parts = UK_PARTS.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO weekday, Monday = 1 … Sunday = 7, for a `YYYY-MM-DD` string. */
export function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The Friday a shift ending at `endsAt` is paid on, as `YYYY-MM-DD`.
 *
 * Sunday of the shift's own Mon-Sun week, then five days on to the Friday
 * of the following week. A shift that ends ON a Sunday is paid five days
 * later; one that ends on the Monday before it waits eleven.
 */
export function payDateFor(endsAt: Date): string {
  const worked = ukDate(endsAt);
  const sunday = addDays(worked, 7 - isoWeekday(worked));
  return addDays(sunday, 5);
}

/**
 * Whether that Friday has arrived. Until it has, the shift is worked but
 * not paid, and §10.1's Earnings history does not carry it — the screen
 * would otherwise tell a worker they had been paid on Tuesday.
 */
export function isPaid(payDate: string, now: Date = new Date()): boolean {
  return payDate <= ukDate(now);
}

/** "Fri 11 Sep", the pill on each earnings card. */
export function formatPayDate(payDate: string): string {
  // formatDateIn: Intl's own output differs by engine ("Fri, 11 Sept" in
  // Chrome, "Fri 11 Sep" in Safari) and would not hydrate.
  return formatDateIn(new Date(`${payDate}T00:00:00Z`), 'UTC', { weekday: 'short' });
}

/** "Sep 2026", the label on the "Paid so far" tile. */
export function payMonthLabel(payDate: string): string {
  return formatDateIn(new Date(`${payDate}T00:00:00Z`), 'UTC', { day: false, year: true });
}

/** The `YYYY-MM` a pay date falls in, for the "Paid so far" total. */
export function payMonth(payDate: string): string {
  return payDate.slice(0, 7);
}

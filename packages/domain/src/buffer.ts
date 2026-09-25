/**
 * Headcount, buffer and fill counts — Scope §3.2, §3.3.
 *
 * The buffer is an absolute number of extra people on top of the headcount.
 * It is displayed as `6 (+1)` and never collapsed into `7`, because the
 * headcount is what the client pays for and the buffer is THC's own cover.
 * Fill counts count CONFIRMED bookings only — invited and potential never
 * count towards the fill.
 */

export interface RoleSectionCounts {
  headcount: number;
  buffer: number;
  confirmed: number;
  invited: number;
}

/** "6 (+1)", or plain "6" when there is no buffer. */
export function formatAllocation(headcount: number, buffer: number): string {
  return buffer > 0 ? `${headcount} (+${buffer})` : String(headcount);
}

/**
 * The same pair with the buffer always spelled out, even at zero: "2 (+0)".
 *
 * The Shift Builder shows this form (§3.2, `shift-builder.html`) because the
 * manager is editing headcount and buffer side by side and needs to see which
 * number is which. Lists and the calendar use `formatAllocation`, which drops
 * a zero buffer. Neither ever renders the total.
 */
export function formatAllocationPair(headcount: number, buffer: number): string {
  return `${headcount} (+${buffer})`;
}

/** "3 (+1) = 4" — what auto-assign fills up to, with the sum kept visible. */
export function formatConfirmationTarget(headcount: number, buffer: number): string {
  return `${formatAllocationPair(headcount, buffer)} = ${allocationTarget(headcount, buffer)}`;
}

/** How many people auto-assign may seat in total: headcount plus buffer. */
export function allocationTarget(headcount: number, buffer: number): number {
  return headcount + buffer;
}

/** "4/6" — confirmed against headcount, never against headcount+buffer. */
export function formatFill(counts: RoleSectionCounts): string {
  return `${counts.confirmed}/${counts.headcount}`;
}

export function isFilled(counts: RoleSectionCounts): boolean {
  return counts.confirmed >= counts.headcount;
}

/** Seats auto-assign still wants to offer, measured against headcount+buffer. */
export function seatsToOffer(counts: RoleSectionCounts): number {
  return Math.max(0, allocationTarget(counts.headcount, counts.buffer) - counts.confirmed);
}

/**
 * RULE-15 strict buffer at check-in: the first `headcount` people to check in
 * work the shift. Anyone after that is turned away — paid a fixed 4 hours if
 * they arrived on time, nothing if they were late.
 */
export function isTurnedAway(checkInOrdinal: number, headcount: number): boolean {
  return checkInOrdinal > headcount;
}

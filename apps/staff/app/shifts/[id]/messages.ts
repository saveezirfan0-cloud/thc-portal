/**
 * The shift screen's copy — the ONE table (audit D19).
 *
 * The message keys the check-in / check-out / break RPCs return, in the
 * worker's language (§5.1), plus the full-screen states built from them.
 * `ShiftScreen` used to keep a second copy of this table, which is how the
 * off-site check-out lost its time and the turn-away lost its last
 * sentence; there is now nowhere else for either to live.
 */

/** §3.2, word for word. The middle sentence only for an on-time attempt (RULE-15). */
export const TURNED_AWAY_LEAD =
  'Thanks for coming — this shift is already fully staffed, so you’re not needed today.';
export const TURNED_AWAY_PAID =
  'We’ve logged that you arrived on time and you’ll be paid for 4 hours.';
export const TURNED_AWAY_TAIL = 'Please check your app for other shifts.';

export function turnedAwayMessage(paid: boolean): string {
  return [TURNED_AWAY_LEAD, paid ? TURNED_AWAY_PAID : null, TURNED_AWAY_TAIL]
    .filter(Boolean)
    .join(' ');
}

export const CHECK_IN_MESSAGES: Record<string, string> = {
  checked_in: 'You’re checked in. Have a good shift.',
  checked_in_late: 'You’re checked in, and marked as arriving late.',
  out_of_radius: 'You’re not close enough to the venue yet.',
  check_in_not_open: 'Check-in is not open yet.',
  no_show_locked: 'Check-in has closed for this shift. Contact the office.',
  turned_away_paid: turnedAwayMessage(true),
  turned_away_unpaid: turnedAwayMessage(false),
  already_checked_in: 'You’re already checked in.',
};

/** §5.1 / RULE-02 second trigger, word for word. */
export const NO_ON_SITE_FIX =
  'We couldn’t confirm when you left the venue — the office will confirm your finish time with you.';

export const MESSAGES: Record<string, string> = {
  ...CHECK_IN_MESSAGES,
  checked_out: 'You’re checked out.',
  checked_out_off_site: checkedOutOffSiteMessage(null),
  no_check_out_office_confirms: NO_ON_SITE_FIX,
  no_check_out_locked: 'Check-out has closed. The office will confirm your finish time with you.',
  on_break: 'Break started.',
  break_finished: 'Break finished — back to work.',
  already_checked_out: 'You’ve already checked out.',
};

/**
 * §5.1: "You checked out away from the venue — we've recorded your last
 * time on site, 16:00". The time is the worker's own clock (§1.8, an actual
 * stamp), formatted by the caller; without one the sentence still stands.
 */
export function checkedOutOffSiteMessage(lastOnSite: string | null): string {
  const base = 'You checked out away from the venue — we’ve recorded your last time on site';
  return lastOnSite ? `${base}, ${lastOnSite}.` : `${base}.`;
}

/**
 * The sentence for a key the server returned, with the time filled in
 * where the copy carries one. Unknown keys return null: the screen then
 * shows nothing rather than a code.
 */
export function messageFor(key: string, opts: { lastOnSite?: string | null } = {}): string | null {
  if (key === 'checked_out_off_site') return checkedOutOffSiteMessage(opts.lastOnSite ?? null);
  return MESSAGES[key] ?? null;
}

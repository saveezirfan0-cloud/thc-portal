import { TURN_AWAY_PAY_MIN, turnedAwayMessage } from '@thc/domain';

/**
 * The message keys the check-in / check-out / break RPCs return, in the
 * worker's language (§5.1 copy). One table, read by the shift screen and
 * by the today card's check-in (§10.4).
 */
export const CHECK_IN_MESSAGES: Record<string, string> = {
  checked_in: 'You’re checked in. Have a good shift.',
  checked_in_late: 'You’re checked in, and marked as arriving late.',
  out_of_radius: 'You’re not close enough to the venue yet.',
  check_in_not_open: 'Check-in is not open yet.',
  no_show_locked: 'Check-in has closed for this shift. Contact the office.',
  // §3.2, RULE-15: the copy is @thc/domain's, not restated here.
  turned_away_paid: turnedAwayMessage(TURN_AWAY_PAY_MIN),
  turned_away_unpaid: turnedAwayMessage(0),
  already_checked_in: 'You’re already checked in.',
};

/**
 * §5.1 / RULE-02 second trigger, word for word: off site, and no on-site
 * fix after check-in. The full-screen state (FullScreens.tsx) and the
 * message table say the same sentence.
 */
export const NO_ON_SITE_FIX =
  'We couldn’t confirm when you left the venue — the office will confirm your finish time with you.';

export const MESSAGES: Record<string, string> = {
  ...CHECK_IN_MESSAGES,
  checked_out: 'You’re checked out.',
  no_check_out_office_confirms: NO_ON_SITE_FIX,
  no_check_out_locked: 'Check-out has closed. The office will confirm your finish time with you.',
  // §5.1: check-out is enabled "once the shift has started" — a press
  // before the ROLE section's start (RULE-18) is refused by check_out().
  check_out_not_open: 'Check-out opens at the scheduled start of your shift.',
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
 * The sentence for one RPC result. Every key is a fixed string but one:
 * `checked_out_off_site` quotes the time that was recorded — the RPC's
 * `recordedAt`, the last on-site fix — and the caller formats it in the
 * worker's own zone (§1.8: an actual stamp shows viewer-local only).
 */
export function rpcMessage(
  result: Record<string, unknown>,
  formatTime: (iso: string) => string,
): string | null {
  const key = String(result.messageKey ?? '');
  if (key === 'checked_out_off_site') {
    const at = result.recordedAt;
    return checkedOutOffSiteMessage(typeof at === 'string' ? formatTime(at) : null);
  }
  return MESSAGES[key] ?? null;
}

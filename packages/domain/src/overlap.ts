/**
 * Booked-elsewhere — Scope §3.4, the hard gate auto-assign applies before it
 * scores anyone, and the check `accept_invite` repeats at the moment a worker
 * presses Accept.
 *
 * THC settled the rule on 14.07.2026 and it is narrower than it looks:
 *
 *  - Only the worker's other CONFIRMED bookings count. An invitation they
 *    have not accepted never excludes them — a worker is meant to hold
 *    several open invitations at once, including overlapping ones (§3.4).
 *  - Two confirmed bookings at the SAME venue, back-to-back, are always
 *    fine. No gap is required.
 *  - Two confirmed bookings at DIFFERENT venues need a gap of at least two
 *    hours between the end of one and the start of the other.
 *  - The two hours are a fixed figure for v1, NOT a travel-time calculation.
 *    The scope is explicit that the same two hours apply however close or far
 *    apart the venues actually are; real routing is scoped out. It is read
 *    from `settings.booked_elsewhere_gap_minutes` so it can be tuned without
 *    a deploy, which is why it is a parameter here rather than a constant.
 *
 * What the scope does not spell out, because it is physics rather than
 * policy: two windows that genuinely INTERSECT cannot both be worked, at one
 * venue or two. "Back-to-back" means one ends before the other starts. An
 * intersection is therefore a conflict whatever the venue, and the same-venue
 * exemption applies only to a non-negative gap.
 *
 * Held to `overlap.vectors.json`, which pgTAP runs against the SQL
 * `booked_elsewhere_conflict()` in the same shape as the cap and pay vectors.
 */

/** The default in `settings.booked_elsewhere_gap_minutes` (0001_init.sql). */
export const DEFAULT_DIFFERENT_VENUE_GAP_MINUTES = 120;

export interface BookingWindow {
  /** Epoch milliseconds. */
  startsAt: number;
  /** Epoch milliseconds. */
  endsAt: number;
  /** Null is treated as "not the same venue": an unknown venue never earns the exemption. */
  venueId: string | null;
}

export type OverlapVerdict =
  /** The windows intersect: unworkable at any venue. */
  | 'intersects'
  /** Different venues and the gap is under the required minimum. */
  | 'gap_too_short'
  /** No conflict. */
  | 'clear';

const MINUTE_MS = 60_000;

/**
 * Whether a candidate shift conflicts with one confirmed booking the worker
 * already holds. Order does not matter: the earlier of the two is worked out
 * here rather than assumed.
 */
export function overlapVerdict(
  candidate: BookingWindow,
  held: BookingWindow,
  gapMinutes: number = DEFAULT_DIFFERENT_VENUE_GAP_MINUTES,
): OverlapVerdict {
  if (candidate.startsAt < held.endsAt && held.startsAt < candidate.endsAt) {
    return 'intersects';
  }

  // Same venue, and they do not intersect, so they are back-to-back at worst.
  // A null venue id is never "the same venue" — see the header.
  if (candidate.venueId !== null && held.venueId !== null && candidate.venueId === held.venueId) {
    return 'clear';
  }

  const [earlier, later] =
    candidate.startsAt < held.startsAt ? [candidate, held] : [held, candidate];
  const gap = later.startsAt - earlier.endsAt;

  return gap < gapMinutes * MINUTE_MS ? 'gap_too_short' : 'clear';
}

/** True where any confirmed booking the worker holds bars this shift (§3.4). */
export function isBookedElsewhere(
  candidate: BookingWindow,
  confirmed: readonly BookingWindow[],
  gapMinutes: number = DEFAULT_DIFFERENT_VENUE_GAP_MINUTES,
): boolean {
  return confirmed.some((held) => overlapVerdict(candidate, held, gapMinutes) !== 'clear');
}

/**
 * The invitations that Accept must withdraw (§3.4, the 14.07.2026 decision):
 * "the moment the worker presses Accept on one of them, the system
 * automatically withdraws all of that worker's other open invitations that
 * overlap its time window".
 *
 * Note the asymmetry with `isBookedElsewhere`, and that it is deliberate.
 * Withdrawal is keyed on the time window INTERSECTING, not on the two-hour
 * travel gap. An invitation ninety minutes after a confirmed shift at another
 * venue is one the worker can no longer accept, but it is not withdrawn from
 * under them — the office may yet move it, and §3.4 says invitations are
 * never withdrawn except by this overlap rule. Widening it to the gap would
 * silently clear invitations the worker can still watch.
 */
export function invitationsToWithdraw<T extends BookingWindow>(
  accepted: BookingWindow,
  openInvitations: readonly T[],
): T[] {
  return openInvitations.filter(
    (invite) => accepted.startsAt < invite.endsAt && invite.startsAt < accepted.endsAt,
  );
}

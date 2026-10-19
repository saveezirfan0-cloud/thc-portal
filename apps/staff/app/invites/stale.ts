/**
 * Where a tap on a stale N5 lands (§8 N5 → `/invites/:id`, §10.4).
 *
 * N5 deep-links the invitation, and the push stays in the phone's tray after
 * the worker has acted on it from the app. Tapping it later used to reach a
 * 404 ("We couldn't find that … no longer yours to view") for an invitation
 * the worker had ACCEPTED — a shift that is very much theirs — and for one
 * whose event the office had since cancelled. The booking's own screen
 * answers both: the shift itself, or §10.4's static "This event has been
 * cancelled" screen.
 *
 * Anything else that is no longer an invitation — declined, closed, lapsed,
 * or withdrawn by the office (N10d already said so in the invitation's own
 * words; `/shifts/:id` would say "You've been removed from this shift", the
 * N10b copy ADR-0037 keeps away from invitees) — stays the 404.
 */
export function staleInviteTarget(booking: {
  bookingId: string;
  status: string;
  eventCancelledAt: Date | null;
}): string | null {
  if (booking.status === 'invited') return null;
  const booked =
    booking.status === 'confirmed' ||
    booking.status === 'worked' ||
    booking.status === 'turned_away';
  if (booked || booking.eventCancelledAt) return `/shifts/${booking.bookingId}`;
  return null;
}
